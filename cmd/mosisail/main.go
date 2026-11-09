// MosiSail: Segel-Cockpit (Wetter, Karte, Logbuch, Saisonabschluss) unter https://mosi.sail
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
	"github.com/mosi-pro/debian-watch/internal/sailapp"
	"github.com/mosi-pro/debian-watch/internal/update"
	"golang.org/x/term"
)

var version = "dev"

const usage = `MosiSail %s

Aufruf: mosisail [-c config.toml] <befehl>

  serve            Server starten (Standard)
  passwd <user>    Benutzer anlegen bzw. Passwort setzen
  update           neuestes GitHub-Release installieren
  version          Version anzeigen
`

func main() {
	cfgPath := flag.String("c", "/etc/mosisail/config.toml", "Pfad zur config.toml")
	flag.Usage = func() { fmt.Fprintf(os.Stderr, usage, version) }
	flag.Parse()
	cmd := "serve"
	if flag.NArg() > 0 {
		cmd = flag.Arg(0)
	}
	load := func() config.Config {
		c, err := config.LoadWith(*cfgPath, config.SailDefault())
		if err != nil {
			log.Fatal(err)
		}
		return c
	}
	switch cmd {
	case "version":
		fmt.Println(version)
	case "update":
		tag, err := update.Apply("mosisail", version)
		if err != nil {
			log.Fatalf("Update: %v (%s)", err, tag)
		}
		fmt.Printf("Aktualisiert auf %s. Dienst neu starten: systemctl restart mosisail\n", tag)
	case "passwd":
		if flag.NArg() < 2 {
			log.Fatal("Aufruf: mosisail passwd <user>")
		}
		cfg := load()
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
		a, err := sailapp.New(load(), version)
		if err != nil {
			log.Fatal(err)
		}
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		if err := a.Run(ctx); err != nil {
			log.Fatal(err)
		}
	default:
		flag.Usage()
		os.Exit(2)
	}
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
