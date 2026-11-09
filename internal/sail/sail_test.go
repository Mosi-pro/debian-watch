package sail

import (
	"math"
	"testing"
)

func entries() []Entry {
	return []Entry{
		{Date: "2026-05-01", Title: "A", Type: "Törn", Boat: "Mosi", Crew: "Anna, Jonas", Distance: 10, Hours: 2, WindAvg: 8, WindMax: 15},
		{Date: "2026-05-01", Title: "B", Type: "Regatta", Boat: "Mosi", Crew: "Anna", Distance: 5, Hours: 1, WindAvg: 12, WindMax: 24},
		{Date: "2026-08-10", Title: "C", Type: "Törn", Boat: "Lotte", Crew: " Jonas ", Distance: 20, Hours: 5},
	}
}

func TestCompute(t *testing.T) {
	st := Compute(entries())
	if st.Trips != 3 || st.Days != 2 || st.NM != 35 || st.Hours != 8 {
		t.Fatalf("%+v", st)
	}
	if st.AvgSpeed != 4.4 || st.WindAvg != 10 || st.WindMax != 24 {
		t.Fatalf("avg=%v wind=%v max=%v", st.AvgSpeed, st.WindAvg, st.WindMax)
	}
	if st.ByMonth[4] != 15 || st.ByMonth[7] != 20 || st.TripsMonth[4] != 2 {
		t.Fatalf("months %v", st.ByMonth)
	}
	if st.Longest.Title != "C" || st.Fastest.Title != "B" || st.First != "2026-05-01" || st.Last != "2026-08-10" {
		t.Fatalf("highlights %+v %+v", st.Longest, st.Fastest)
	}
	if st.Crew[0].Name != "Anna" && st.Crew[0].Name != "Jonas" || len(st.Crew) != 2 {
		t.Fatalf("crew %+v", st.Crew)
	}
	if e := Compute(nil); e.Trips != 0 || e.AvgSpeed != 0 {
		t.Fatal("empty")
	}
}

func TestNormalize(t *testing.T) {
	bad := []Entry{
		{Date: "2026-13-40", Title: "x"}, {Date: "2026-05-01", Title: " "}, {Date: "26-5-1", Title: "x"},
		{Date: "2026-05-01", Title: "x", Start: "25:00"}, {Date: "2026-05-01", Title: "x", Route: [][2]float64{{99, 0}}},
	}
	for i, e := range bad {
		if Normalize(&e) == nil {
			t.Errorf("bad[%d] accepted", i)
		}
	}
	e := Entry{Date: "2026-05-01", Title: "x", Type: "??", Distance: 99999, WindDir: 999}
	if err := Normalize(&e); err != nil || e.Type != "Törn" || e.Distance != 5000 || e.WindDir != 0 {
		t.Fatalf("%+v %v", e, err)
	}
}

func TestSeasonLifecycle(t *testing.T) {
	s, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	var id string
	for _, e := range entries() {
		out, err := s.Add(e)
		if err != nil {
			t.Fatal(err)
		}
		id = out.ID
	}
	if _, err := s.CloseSeason(2025, "", "x"); err == nil {
		t.Fatal("empty season closed")
	}
	se, err := s.CloseSeason(2026, "super", "mosi")
	if err != nil || se.Stats.Trips != 3 {
		t.Fatal(err, se)
	}
	if _, err := s.CloseSeason(2026, "", "x"); err == nil {
		t.Fatal("closed twice")
	}
	if _, err := s.Add(Entry{Date: "2026-09-01", Title: "neu"}); err != ErrClosed {
		t.Fatalf("add into closed: %v", err)
	}
	if _, err := s.Update(id, Entry{Date: "2026-08-10", Title: "z"}); err != ErrClosed {
		t.Fatalf("update closed: %v", err)
	}
	if err := s.Delete(id); err != ErrClosed {
		t.Fatalf("delete closed: %v", err)
	}
	if _, err := s.Add(Entry{Date: "2027-01-01", Title: "next"}); err != nil {
		t.Fatalf("other year blocked: %v", err)
	}
	// Persistenz
	s2, _ := OpenStore(s.path[:len(s.path)-len("/sail.json")])
	if es, season := s2.Year(2026); len(es) != 3 || season == nil || season.Note != "super" {
		t.Fatalf("not persisted: %d %v", len(es), season)
	}
	if err := s.ReopenSeason(2026); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete(id); err != nil {
		t.Fatalf("delete after reopen: %v", err)
	}
}

func TestRouteNM(t *testing.T) {
	// 1 Breitengrad = 60 sm
	d := RouteNM([][2]float64{{48, 11}, {49, 11}})
	if math.Abs(d-60) > 0.2 {
		t.Fatalf("%v", d)
	}
}
