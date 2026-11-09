// Package update downloads the latest GitHub release and replaces the running binary.
package update

import (
	"archive/tar"
	"bufio"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const Repo = "Mosi-pro/debian-watch"

type release struct {
	Tag    string `json:"tag_name"`
	Assets []struct {
		Name string `json:"name"`
		URL  string `json:"browser_download_url"`
	} `json:"assets"`
}

var client = &http.Client{Timeout: 2 * time.Minute}

func Latest() (tag string, err error) {
	r, err := latest()
	return r.Tag, err
}

func latest() (release, error) {
	var r release
	resp, err := client.Get("https://api.github.com/repos/" + Repo + "/releases/latest")
	if err != nil {
		return r, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return r, fmt.Errorf("GitHub API: %s", resp.Status)
	}
	return r, json.NewDecoder(resp.Body).Decode(&r)
}

func get(url string) (io.ReadCloser, error) {
	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != 200 {
		resp.Body.Close()
		return nil, fmt.Errorf("%s: %s", url, resp.Status)
	}
	return resp.Body, nil
}

// Apply installs the newest release if it differs from current. Returns the new tag.
func Apply(app, current string) (string, error) {
	r, err := latest()
	if err != nil {
		return "", err
	}
	if strings.TrimPrefix(r.Tag, "v") == strings.TrimPrefix(current, "v") {
		return r.Tag, errors.New("bereits aktuell")
	}
	want := fmt.Sprintf("%s_", app)
	suffix := fmt.Sprintf("_%s_%s.tar.gz", runtime.GOOS, runtime.GOARCH)
	var tarURL, tarName, sumURL string
	for _, a := range r.Assets {
		switch {
		case strings.HasPrefix(a.Name, want) && strings.HasSuffix(a.Name, suffix):
			tarURL, tarName = a.URL, a.Name
		case a.Name == "checksums.txt":
			sumURL = a.URL
		}
	}
	if tarURL == "" || sumURL == "" {
		return "", fmt.Errorf("Release %s enthält kein Archiv/checksums.txt für %s/%s", r.Tag, runtime.GOOS, runtime.GOARCH)
	}
	// expected checksum
	sb, err := get(sumURL)
	if err != nil {
		return "", err
	}
	var expect string
	sc := bufio.NewScanner(sb)
	for sc.Scan() {
		if f := strings.Fields(sc.Text()); len(f) == 2 && f[1] == tarName {
			expect = f[0]
		}
	}
	sb.Close()
	if expect == "" {
		return "", errors.New("keine Prüfsumme für " + tarName)
	}
	// download + verify
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	exe, _ = filepath.EvalSymlinks(exe)
	tmpArchive, err := os.CreateTemp(filepath.Dir(exe), ".mosideck-dl-*")
	if err != nil {
		return "", err
	}
	defer os.Remove(tmpArchive.Name())
	body, err := get(tarURL)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	_, err = io.Copy(io.MultiWriter(tmpArchive, h), body)
	body.Close()
	tmpArchive.Close()
	if err != nil {
		return "", err
	}
	if hex.EncodeToString(h.Sum(nil)) != expect {
		return "", errors.New("Prüfsumme stimmt nicht — Update abgebrochen")
	}
	// extract binary
	f, _ := os.Open(tmpArchive.Name())
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return "", err
	}
	tr := tar.NewReader(gz)
	newBin := exe + ".new"
	for {
		hd, err := tr.Next()
		if err == io.EOF {
			return "", errors.New("Binary '" + app + "' nicht im Archiv gefunden")
		}
		if err != nil {
			return "", err
		}
		if hd.Typeflag == tar.TypeReg && filepath.Base(hd.Name) == app {
			out, err := os.OpenFile(newBin, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
			if err != nil {
				return "", err
			}
			if _, err := io.Copy(out, io.LimitReader(tr, 200<<20)); err != nil {
				out.Close()
				return "", err
			}
			out.Close()
			break
		}
	}
	if err := os.Rename(newBin, exe); err != nil {
		os.Remove(newBin)
		return "", err
	}
	return r.Tag, nil
}
