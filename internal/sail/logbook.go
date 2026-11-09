package sail

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

type Entry struct {
	ID       string       `json:"id"`
	Date     string       `json:"date"`  // YYYY-MM-DD
	Start    string       `json:"start"` // HH:MM (optional)
	End      string       `json:"end"`
	Title    string       `json:"title"`
	Type     string       `json:"type"` // Törn, Regatta, Training, Überführung, Sonstiges
	Boat     string       `json:"boat"`
	Crew     string       `json:"crew"`     // kommagetrennt
	Distance float64      `json:"distance"` // Seemeilen
	Hours    float64      `json:"hours"`
	WindAvg  float64      `json:"wind_avg"` // kn
	WindMax  float64      `json:"wind_max"`
	WindDir  int          `json:"wind_dir"` // Grad, woher
	Notes    string       `json:"notes"`
	Route    [][2]float64 `json:"route,omitempty"` // [lat, lon]
	Created  string       `json:"created"`
	Updated  string       `json:"updated"`
}

type Season struct {
	Year   int    `json:"year"`
	Closed string `json:"closed"` // RFC3339
	By     string `json:"by"`
	Note   string `json:"note"`
	Stats  Stats  `json:"stats"`
}

type Store struct {
	mu      sync.Mutex
	path    string
	Entries []Entry        `json:"entries"`
	Seasons map[int]Season `json:"seasons"`
}

var (
	ErrNotFound = errors.New("Eintrag nicht gefunden")
	ErrClosed   = errors.New("Diese Saison ist abgeschlossen. Erst wieder öffnen, um Einträge zu ändern.")
	dateRe      = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	timeRe      = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)
)

var Types = []string{"Törn", "Regatta", "Training", "Überführung", "Sonstiges"}

func OpenStore(dir string) (*Store, error) {
	s := &Store{path: filepath.Join(dir, "sail.json"), Seasons: map[int]Season{}}
	b, err := os.ReadFile(s.path)
	if err == nil {
		if err := json.Unmarshal(b, s); err != nil {
			return nil, fmt.Errorf("sail.json: %w", err)
		}
		if s.Seasons == nil {
			s.Seasons = map[int]Season{}
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	return s, nil
}

func (s *Store) save() error {
	b, _ := json.MarshalIndent(s, "", " ")
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func newID() string {
	b := make([]byte, 6)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func yearOf(date string) int {
	var y int
	fmt.Sscanf(date, "%4d", &y)
	return y
}

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func cut(s string, n int) string {
	s = strings.TrimSpace(s)
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}

// Normalize prüft und bereinigt einen Eintrag.
func Normalize(e *Entry) error {
	if !dateRe.MatchString(e.Date) {
		return errors.New("Datum muss JJJJ-MM-TT sein")
	}
	if _, err := time.Parse("2006-01-02", e.Date); err != nil {
		return errors.New("Ungültiges Datum")
	}
	for _, t := range []*string{&e.Start, &e.End} {
		if *t != "" && !timeRe.MatchString(*t) {
			return errors.New("Uhrzeit muss HH:MM sein")
		}
	}
	e.Title = cut(e.Title, 120)
	if e.Title == "" {
		return errors.New("Titel fehlt")
	}
	ok := false
	for _, t := range Types {
		if e.Type == t {
			ok = true
		}
	}
	if !ok {
		e.Type = "Törn"
	}
	e.Boat, e.Crew, e.Notes = cut(e.Boat, 80), cut(e.Crew, 300), cut(e.Notes, 8000)
	e.Distance = clamp(e.Distance, 0, 5000)
	e.Hours = clamp(e.Hours, 0, 240)
	e.WindAvg, e.WindMax = clamp(e.WindAvg, 0, 120), clamp(e.WindMax, 0, 150)
	if e.WindDir < 0 || e.WindDir > 360 {
		e.WindDir = 0
	}
	if len(e.Route) > 5000 {
		return errors.New("Route hat zu viele Punkte (max. 5000)")
	}
	for _, p := range e.Route {
		if p[0] < -90 || p[0] > 90 || p[1] < -180 || p[1] > 180 {
			return errors.New("Ungültige Koordinaten in der Route")
		}
	}
	return nil
}

func (s *Store) Years() []int {
	s.mu.Lock()
	defer s.mu.Unlock()
	set := map[int]bool{time.Now().Year(): true}
	for _, e := range s.Entries {
		set[yearOf(e.Date)] = true
	}
	for y := range s.Seasons {
		set[y] = true
	}
	var ys []int
	for y := range set {
		ys = append(ys, y)
	}
	sort.Sort(sort.Reverse(sort.IntSlice(ys)))
	return ys
}

func (s *Store) Year(y int) ([]Entry, *Season) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []Entry
	for _, e := range s.Entries {
		if yearOf(e.Date) == y {
			out = append(out, e)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Date != out[j].Date {
			return out[i].Date > out[j].Date
		}
		return out[i].Start > out[j].Start
	})
	if se, ok := s.Seasons[y]; ok {
		return out, &se
	}
	return out, nil
}

func (s *Store) Add(e Entry) (Entry, error) {
	if err := Normalize(&e); err != nil {
		return e, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, closed := s.Seasons[yearOf(e.Date)]; closed {
		return e, ErrClosed
	}
	now := time.Now().UTC().Format(time.RFC3339)
	e.ID, e.Created, e.Updated = newID(), now, now
	s.Entries = append(s.Entries, e)
	return e, s.save()
}

func (s *Store) Update(id string, e Entry) (Entry, error) {
	if err := Normalize(&e); err != nil {
		return e, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, old := range s.Entries {
		if old.ID != id {
			continue
		}
		if _, c := s.Seasons[yearOf(old.Date)]; c {
			return e, ErrClosed
		}
		if _, c := s.Seasons[yearOf(e.Date)]; c {
			return e, ErrClosed
		}
		e.ID, e.Created, e.Updated = id, old.Created, time.Now().UTC().Format(time.RFC3339)
		s.Entries[i] = e
		return e, s.save()
	}
	return e, ErrNotFound
}

func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, old := range s.Entries {
		if old.ID == id {
			if _, c := s.Seasons[yearOf(old.Date)]; c {
				return ErrClosed
			}
			s.Entries = append(s.Entries[:i], s.Entries[i+1:]...)
			return s.save()
		}
	}
	return ErrNotFound
}

// CloseSeason friert Statistik und Einträge des Jahres ein.
func (s *Store) CloseSeason(y int, note, by string) (Season, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.Seasons[y]; ok {
		return Season{}, errors.New("Saison ist bereits abgeschlossen")
	}
	var es []Entry
	for _, e := range s.Entries {
		if yearOf(e.Date) == y {
			es = append(es, e)
		}
	}
	if len(es) == 0 {
		return Season{}, errors.New("Keine Einträge in dieser Saison")
	}
	se := Season{Year: y, Closed: time.Now().UTC().Format(time.RFC3339), By: by, Note: cut(note, 4000), Stats: Compute(es)}
	s.Seasons[y] = se
	return se, s.save()
}

func (s *Store) ReopenSeason(y int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.Seasons[y]; !ok {
		return errors.New("Saison ist nicht abgeschlossen")
	}
	delete(s.Seasons, y)
	return s.save()
}
