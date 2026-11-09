package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"net/url"
	"strings"
	"time"
)

var b32 = base32.StdEncoding.WithPadding(base32.NoPadding)

func NewTOTPSecret() string {
	b := make([]byte, 20)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return b32.EncodeToString(b)
}

func hotp(secret string, counter uint64) (string, bool) {
	key, err := b32.DecodeString(strings.ToUpper(secret))
	if err != nil {
		return "", false
	}
	var buf [8]byte
	binary.BigEndian.PutUint64(buf[:], counter)
	h := hmac.New(sha1.New, key)
	h.Write(buf[:])
	s := h.Sum(nil)
	o := s[len(s)-1] & 0xf
	code := (binary.BigEndian.Uint32(s[o:o+4]) & 0x7fffffff) % 1000000
	return fmt.Sprintf("%06d", code), true
}

// VerifyTOTP checks code with a +-1 step window. It returns the matched
// counter so callers can reject replays.
func VerifyTOTP(secret, code string, now time.Time) (uint64, bool) {
	code = strings.TrimSpace(code)
	c := uint64(now.Unix() / 30)
	for _, d := range []int64{0, -1, 1} {
		cc := uint64(int64(c) + d)
		if want, ok := hotp(secret, cc); ok && hmac.Equal([]byte(want), []byte(code)) {
			return cc, true
		}
	}
	return 0, false
}

func TOTPURI(issuer, user, secret string) string {
	return fmt.Sprintf("otpauth://totp/%s:%s?secret=%s&issuer=%s&algorithm=SHA1&digits=6&period=30",
		url.PathEscape(issuer), url.PathEscape(user), secret, url.QueryEscape(issuer))
}
