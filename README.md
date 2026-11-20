# Kapitał – rodzinne finanse, zrozumiale

**PL** · [EN](#english) · [DE](#deutsch)

Kapitał pokazuje cały majątek rodziny w jednym miejscu: obligacje skarbowe (EDO, COI, TOS, ROS, ROD…), lokaty, akcje z GPW, fundusze i gotówkę. Liczy wartość dziś, ile zostałoby na rękę po opłatach i podatku, porównuje z inflacją i aktualną ofertą obligacji, śledzi trendy sektorów giełdy i podpowiada, co warto rozważyć. Każda wskazówka ma źródło: badanie naukowe albo przepis.

> Kapitał to narzędzie do analizy i nauki, a nie doradztwo inwestycyjne. Decyzję podejmujesz Ty. Przy dużych kwotach warto porozmawiać z licencjonowanym doradcą.

## Jak uruchomić

| Gdzie | Jak |
|---|---|
| **iPhone / iPad** | Otwórz w Safari **https://michaelkuchno.github.io/kapital/**, potem *Udostępnij → Do ekranu początkowego*. |
| **Android** | Otwórz w Chrome **https://michaelkuchno.github.io/kapital/**, potem *menu ⋮ → Zainstaluj aplikację*. |
| **Komputer** | Ten sam adres w przeglądarce. W Chrome lub Edge możesz też kliknąć ikonę instalacji w pasku adresu. |
| **Serwer domowy (Docker)** | `docker compose up -d`, a potem http://localhost:8080 (z telefonu w tej samej sieci: `http://<IP komputera>:8080`). |

### Docker krok po kroku
1. Zainstaluj Docker Desktop i go uruchom.
2. Pobierz repozytorium: `git clone https://github.com/michaelkuchno/kapital.git` i przejdź do katalogu: `cd kapital`.
3. Wpisz `docker compose up -d --build`.
4. Wejdź na http://localhost:8080.
   - Przy pierwszym starcie serwer pobiera ok. 1,5 roku notowań GPW (ok. 15 minut).
   - Potem robi aktualizację w każdy dzień roboczy o 18:30.
5. Dane leżą w wolumenie `kapital-data`, w bazie SQLite.
   - Komendy:
     - `docker compose logs -f` – log,
     - `docker compose down` – stop,
     - `docker compose pull && docker compose up -d --build` – aktualizacja.
   - Kopię zapasową bazy zrobisz poleceniem `docker run --rm -v kapital-data:/d -v %cd%:/b alpine tar czf /b/kapital-backup.tgz /d`.

## Twoje dane
- Kwoty i pozycje są zapisane **tylko w Twoim urządzeniu** (IndexedDB) i nigdy nie trafiają na GitHub.
- Kopię do przeniesienia na inny telefon zrobisz w *Ustawienia → Kopia zapasowa*.
  - Kopia jest szyfrowana Twoim hasłem: AES-256-GCM, klucz z PBKDF2-SHA256 przy 310 000 iteracjach.
- Serwer domowy przyjmuje tylko taką zaszyfrowaną kopię, więc nie zna ani hasła, ani kwot.

## Skąd są dane (bezpłatne, oficjalne)
Wszystkie dane są aktualizowane codziennie przez GitHub Actions i przez serwer Docker:

| Dane | Źródło |
|---|---|
| Notowania akcji i indeksów (w tym 14 indeksów sektorowych) | archiwum notowań GPW |
| Inflacja (CPI r/r) | GUS (API DBW) |
| Stopa referencyjna, kursy walut, złoto | NBP |
| Aktualna oferta obligacji skarbowych | Ministerstwo Finansów (obligacjeskarbowe.pl) |

Szczegóły i licencje znajdziesz w [docs/SOURCES.md](docs/SOURCES.md).

## Co liczy
- **Obligacje skarbowe** według listów emisyjnych:
  - pierwszy okres stały,
  - potem inflacja ogłoszona przez GUS w miesiącu przed okresem plus marża, nie mniej niż 0,
  - kapitalizacja albo wypłata odsetek,
  - odsetki dzień po dniu,
  - opłaty za wcześniejszy wykup według tabeli sprzed i od 1.09.2024, z limitem do naliczonych odsetek,
  - podatek Belki od odsetek pomniejszonych o opłatę.
- **Lokaty:** odsetki = kapitał × oprocentowanie × dni / 365, Belka przy wypłacie, wartość przy zerwaniu.
- **Akcje:**
  - wynik i podatek przy sprzedaży,
  - wzrost potrzebny do wyjścia na zero,
  - rozliczenie straty z zyskami w PIT-38 (strata nie pomniejsza podatku od odsetek).
- **Trendy GPW:**
  - średnie 50 i 200 sesji,
  - złoty krzyż i krzyż śmierci,
  - momentum 12-1,
  - siła względem WIG,
  - ranking 14 sektorów,
  - zmiany trendu z ostatnich 2 tygodni.
- **Scenariusze:**
  - 2 000 symulacji Monte Carlo z modelem inflacji AR(1) dopasowanym do danych GUS,
  - cele oszczędnościowe,
  - porównanie obligacji i lokaty po podatku i opłatach.

## Rozwój
```
npm ci
npm run dev            # aplikacja
npm test               # 144 testy jednostkowe (silnik i dane: 100 % linii)
npm run e2e            # testy w przeglądarce: komputer, Android, iPhone
npm run data           # pobranie danych do public/data
```

---

## English
Kapitał shows a family's whole wealth in one place: Polish treasury bonds, deposits, GPW shares, funds and cash.
- It values everything today and shows what is left after fees and tax.
- It compares with inflation and the current bond offer.
- It ranks GPW sectors by trend strength and detects trend changes.
- It explains every insight with its research or legal source.

Run it on any phone or computer: **https://michaelkuchno.github.io/kapital/** (add it to the home screen). You can also run it at home with `docker compose up -d` → http://localhost:8080. Your data stays on your device; backups are encrypted. This is an analysis tool, not investment advice.

## Deutsch
Kapitał zeigt das gesamte Familienvermögen an einem Ort: polnische Staatsanleihen, Festgeld, GPW-Aktien, Fonds und Bargeld.
- Es bewertet alles zum heutigen Tag und zeigt, was nach Gebühren und Steuern bleibt.
- Es vergleicht mit der Inflation und dem aktuellen Anleiheangebot.
- Es erstellt eine Rangliste der GPW-Sektoren nach Trendstärke und erkennt Trendwechsel.
- Jeder Hinweis nennt seine Forschungs- oder Rechtsquelle.

Aufruf: **https://michaelkuchno.github.io/kapital/** (zum Startbildschirm hinzufügen). Zu Hause geht es auch per `docker compose up -d` → http://localhost:8080. Die Daten bleiben auf dem Gerät; Sicherungen sind verschlüsselt. Ein Analysewerkzeug, keine Anlageberatung.
