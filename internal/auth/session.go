package auth

import (
	"sync"
	"time"
)

type Session struct {
	User    string
	CSRF    string
	Expires time.Time
}

type Sessions struct {
	mu  sync.Mutex
	m   map[string]*Session
	ttl time.Duration
}

func NewSessions(ttl time.Duration) *Sessions {
	s := &Sessions{m: map[string]*Session{}, ttl: ttl}
	go func() {
		for range time.Tick(5 * time.Minute) {
			s.mu.Lock()
			for k, v := range s.m {
				if time.Now().After(v.Expires) {
					delete(s.m, k)
				}
			}
			s.mu.Unlock()
		}
	}()
	return s
}

func (s *Sessions) New(user string) (token string, sess Session) {
	token = RandomToken(32)
	sess = Session{User: user, CSRF: RandomToken(16), Expires: time.Now().Add(s.ttl)}
	s.mu.Lock()
	s.m[token] = &sess
	s.mu.Unlock()
	return
}

func (s *Sessions) Get(token string) (Session, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.m[token]
	if !ok || time.Now().After(v.Expires) {
		delete(s.m, token)
		return Session{}, false
	}
	return *v, true
}

func (s *Sessions) Delete(token string) {
	s.mu.Lock()
	delete(s.m, token)
	s.mu.Unlock()
}

// DeleteUser logs a user out everywhere (after password change / delete).
func (s *Sessions) DeleteUser(user, keepToken string) {
	s.mu.Lock()
	for k, v := range s.m {
		if v.User == user && k != keepToken {
			delete(s.m, k)
		}
	}
	s.mu.Unlock()
}

// Limiter implements failure counting with lockout, keyed by arbitrary string.
type Limiter struct {
	mu    sync.Mutex
	m     map[string]*entry
	max   int
	lock  time.Duration
	reset time.Duration
}

type entry struct {
	fails int
	last  time.Time
	until time.Time
}

func NewLimiter(max int, lock time.Duration) *Limiter {
	return &Limiter{m: map[string]*entry{}, max: max, lock: lock, reset: 15 * time.Minute}
}

// Blocked reports whether key is locked and for how long.
func (l *Limiter) Blocked(key string) (time.Duration, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	e := l.m[key]
	if e == nil {
		return 0, false
	}
	if d := time.Until(e.until); d > 0 {
		return d, true
	}
	return 0, false
}

func (l *Limiter) Fail(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	e := l.m[key]
	if e == nil {
		e = &entry{}
		l.m[key] = e
	}
	if time.Since(e.last) > l.reset {
		e.fails = 0
	}
	e.fails++
	e.last = time.Now()
	if e.fails >= l.max {
		e.until = time.Now().Add(l.lock)
		e.fails = 0
	}
	if len(l.m) > 10000 { // bound memory
		for k, v := range l.m {
			if time.Since(v.last) > l.reset {
				delete(l.m, k)
			}
		}
	}
}

func (l *Limiter) Success(key string) {
	l.mu.Lock()
	delete(l.m, key)
	l.mu.Unlock()
}
