// MosiDeck: login, web terminal and live system metrics in a single binary.
package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/mosi-pro/debian-watch/internal/auth"
	"github.com/mosi-pro/debian-watch/internal/config"
	"github.com/mosi-pro/debian-watch/internal/server"
	"github.com/mosi-pro/debian-watch/internal/update"
	"golang.org/x/term"
)

var version = "dev" // set by GoReleaser via -ldflags

const usage = `MosiDeck %s

Aufruf: mosideck [-c config.toml] <befehl>

  serve            Server starten (Standard)
  passwd <user>    Benutzer anlegen bzw. Passwort setzen
  update           neuestes GitHub-Release installieren
  version          Version anzeigen
`

func main() {
	cfgPath := flag.String("c", "/etc/mosideck/config.toml", "Pfad zur config.toml")
	flag.Usage = func() { fmt.Fprintf(os.Stderr, usage, version) }
	flag.Parse()
	cmd := "serve"
	if flag.NArg() > 0 {
		cmd = flag.Arg(0)
	}
	switch cmd {
	case "version":
		fmt.Println(version)
	case "update":
		tag, err := update.Apply(version)
		if err != nil {
			log.Fatalf("Update: %v (%s)", err, tag)
		}
		fmt.Printf("Aktualisiert auf %s. Dienst neu starten: sudo systemctl restart mosideck\n", tag)
	case "passwd":
		if flag.NArg() < 2 {
			log.Fatal("Aufruf: mosideck passwd <user>")
		}
		cfg := mustLoad(*cfgPath)
		st, err := auth.OpenStore(cfg.DataDir)
		if err != nil {
			log.Fatal(err)
		}
		pw := readPassword()
		name := flag.Arg(1)
		if _, ok := st.Get(name); ok {
			err = st.SetPassword(name, pw)
		} else {
			err = st.Create(name, pw)
		}
		if err != nil {
			log.Fatal(err)
		}
		fmt.Println("OK")
	case "serve":
		cfg := mustLoad(*cfgPath)
		s, err := server.New(cfg, version)
		if err != nil {
			log.Fatal(err)
		}
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		if err := s.Run(ctx); err != nil {
			log.Fatal(err)
		}
	default:
		flag.Usage()
		os.Exit(2)
	}
}

func mustLoad(p string) config.Config {
	c, err := config.Load(p)
	if err != nil {
		log.Fatal(err)
	}
	return c
}

func readPassword() string {
	fd := int(os.Stdin.Fd())
	if term.IsTerminal(fd) {
		fmt.Fprint(os.Stderr, "Neues Passwort: ")
		b, err := term.ReadPassword(fd)
		fmt.Fprintln(os.Stderr)
		if err != nil {
			log.Fatal(err)
		}
		return string(b)
	}
	l, _ := bufio.NewReader(os.Stdin).ReadString('\n')
	return strings.TrimRight(l, "\r\n")
}
