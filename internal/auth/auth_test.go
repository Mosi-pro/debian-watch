package auth

import (
	"testing"
	"time"
)

func TestPasswordRoundTrip(t *testing.T) {
	h, err := HashPassword("correct-horse-1")
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyPassword("correct-horse-1", h) || VerifyPassword("wrong", h) {
		t.Fatal("verify mismatch")
	}
	if VerifyPassword("x", "garbage") {
		t.Fatal("garbage hash accepted")
	}
}

// RFC 6238 test vector: secret "12345678901234567890", T=59 -> 94287082 (8 digits) => 287082 (6 digits).
func TestTOTPVector(t *testing.T) {
	secret := b32.EncodeToString([]byte("12345678901234567890"))
	if _, ok := VerifyTOTP(secret, "287082", time.Unix(59, 0)); !ok {
		t.Fatal("RFC 6238 vector rejected")
	}
	if _, ok := VerifyTOTP(secret, "000000", time.Unix(59, 0)); ok {
		t.Fatal("bad code accepted")
	}
}

func TestLimiterLockout(t *testing.T) {
	l := NewLimiter(3, time.Minute)
	for i := 0; i < 3; i++ {
		l.Fail("a")
	}
	if _, b := l.Blocked("a"); !b {
		t.Fatal("expected lockout")
	}
	if _, b := l.Blocked("b"); b {
		t.Fatal("unrelated key blocked")
	}
	l.Success("a")
	if _, b := l.Blocked("a"); b {
		t.Fatal("success should clear")
	}
}

func TestStore(t *testing.T) {
	s, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Create("mosi", "short"); err == nil {
		t.Fatal("weak password accepted")
	}
	if err := s.Create("../x", "long-enough-pw"); err == nil {
		t.Fatal("bad name accepted")
	}
	if err := s.Create("mosi", "long-enough-pw"); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete("mosi"); err == nil {
		t.Fatal("last user deleted")
	}
	s2, _ := OpenStore(s.path[:len(s.path)-len("/users.json")])
	if _, ok := s2.Get("mosi"); !ok {
		t.Fatal("not persisted")
	}
}
