package auth

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"sync"
)

type User struct {
	Name        string `json:"name"`
	Hash        string `json:"hash"`
	TOTPSecret  string `json:"totp_secret,omitempty"`
	TOTPEnabled bool   `json:"totp_enabled"`
	LastTOTP    uint64 `json:"last_totp,omitempty"`
}

// Store keeps users in one JSON file (0600). No database server needed.
type Store struct {
	mu    sync.Mutex
	path  string
	Users map[string]*User `json:"users"`
}

var nameRe = regexp.MustCompile(`^[a-zA-Z0-9._-]{1,32}$`)

var ErrExists = errors.New("Benutzer existiert bereits")
var ErrNotFound = errors.New("Benutzer nicht gefunden")
var ErrName = errors.New("Benutzername: 1-32 Zeichen aus a-z, 0-9, . _ -")

func OpenStore(dir string) (*Store, error) {
	s := &Store{path: filepath.Join(dir, "users.json"), Users: map[string]*User{}}
	b, err := os.ReadFile(s.path)
	if err == nil {
		if err := json.Unmarshal(b, s); err != nil {
			return nil, err
		}
		if s.Users == nil {
			s.Users = map[string]*User{}
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	return s, nil
}

func (s *Store) save() error {
	b, _ := json.MarshalIndent(s, "", "  ")
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func (s *Store) Empty() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.Users) == 0
}

func (s *Store) Get(name string) (User, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.Users[name]
	if !ok {
		return User{}, false
	}
	return *u, true
}

func (s *Store) List() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	var n []string
	for k := range s.Users {
		n = append(n, k)
	}
	sort.Strings(n)
	return n
}

func (s *Store) Create(name, pw string) error {
	if !nameRe.MatchString(name) {
		return ErrName
	}
	if err := CheckStrength(pw); err != nil {
		return err
	}
	h, err := HashPassword(pw)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.Users[name]; ok {
		return ErrExists
	}
	s.Users[name] = &User{Name: name, Hash: h}
	return s.save()
}

func (s *Store) SetPassword(name, pw string) error {
	if err := CheckStrength(pw); err != nil {
		return err
	}
	h, err := HashPassword(pw)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.Users[name]
	if !ok {
		return ErrNotFound
	}
	u.Hash = h
	return s.save()
}

func (s *Store) Delete(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.Users[name]; !ok {
		return ErrNotFound
	}
	if len(s.Users) == 1 {
		return errors.New("Der letzte Benutzer kann nicht gelöscht werden")
	}
	delete(s.Users, name)
	return s.save()
}

// Update runs fn under lock on the user and persists the result.
func (s *Store) Update(name string, fn func(u *User) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.Users[name]
	if !ok {
		return ErrNotFound
	}
	if err := fn(u); err != nil {
		return err
	}
	return s.save()
}
