package term

import (
	"bufio"
	"os"
	"strings"
)

// loginShell looks the user's shell up in /etc/passwd (no cgo needed).
func loginShell(name string) string {
	f, err := os.Open("/etc/passwd")
	if err != nil {
		return ""
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		p := strings.Split(sc.Text(), ":")
		if len(p) >= 7 && p[0] == name {
			if _, err := os.Stat(p[6]); err == nil {
				return p[6]
			}
		}
	}
	return ""
}
