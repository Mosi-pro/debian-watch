package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoad(t *testing.T) {
	p := filepath.Join(t.TempDir(), "c.toml")
	os.WriteFile(p, []byte("# x\nlisten = \"0.0.0.0:9000\"\nallow_root = true # hmm\nsession_hours = 3\n"), 0o600)
	c, err := Load(p)
	if err != nil || c.Listen != "0.0.0.0:9000" || !c.AllowRoot || c.SessionHours != 3 {
		t.Fatalf("%+v %v", c, err)
	}
	os.WriteFile(p, []byte("bogus = 1\n"), 0o600)
	if _, err := Load(p); err == nil {
		t.Fatal("unknown key accepted")
	}
}
