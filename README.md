# NL_Bot — Discord bot do zarządzania klanem

Bot dla klanów i społeczności gamingowych: **rekrutacja przez formularz**, **hierarchia ról**,
**moderacja z rejestrem ostrzeżeń**, **automoderacja**, **ekonomia klanowa ze sklepem**, **logi zdarzeń**
i **statystyki serwera**.

Wszystkie widoczne dla użytkownika wiadomości budowane są w **Discord Components V2**
(`Container`, `Section`, `TextDisplay`, `Separator`, `ActionRow`) — bot nie używa klasycznych embedów.
Konfiguracja jest w pełni **per-serwer** i trzymana w bazie SQLite, więc jedna instancja obsługuje wiele serwerów.

---

## Spis treści

- [Funkcje](#funkcje)
- [Wymagania](#wymagania)
- [Instalacja](#instalacja)
- [Konfiguracja aplikacji Discord](#konfiguracja-aplikacji-discord)
- [Pierwsze uruchomienie na serwerze](#pierwsze-uruchomienie-na-serwerze)
- [Komendy](#komendy)
- [Struktura projektu](#struktura-projektu)
- [Baza danych](#baza-danych)
- [Components V2](#components-v2)
- [Testy](#testy)
- [Rozwijanie bota](#rozwijanie-bota)
- [Najczęstsze problemy](#najczęstsze-problemy)

---

## Funkcje

### 1. Rekrutacja

- **Dwa niezależne zestawy pytań**:
  - 📝 **formularz kandydata** — widzi go osoba składająca zgłoszenie (`/rekrutacja`),
  - 🧭 **ankieta rekrutera** — widoczna **tylko dla administracji**, wypełniana pod zgłoszeniem
    przyciskiem *Wypełnij ocenę*. Kandydat nigdy jej nie widzi.

  Każdy zestaw ma własną numerację, własny limit 5 pytań i własny zestaw domyślny.
- **Panel administracyjny pytań** (`/pytania panel`) — dodawanie, edycja, usuwanie i zmiana kolejności
  pytań przyciskami i modalami, z przełącznikiem między zestawami. Zestaw startowy jednym kliknięciem.
- **Formularz** (`/rekrutacja` lub przycisk w panelu rekrutacji) — modal generowany dynamicznie
  z pytań zapisanych dla danego serwera (do 5 pól, limit Discorda).
- **Zgłoszenia na kanale administracyjnym** — karta Components V2 z odpowiedziami kandydata,
  awatarem i przyciskami **Akceptuj / Odrzuć / Profil kandydata / Wypełnij ocenę**.
- **Oceny rekruterów** — każdy oficer wypełnia własną ankietę (ponowne kliknięcie pozwala ją poprawić),
  a wszystkie oceny są widoczne pod zgłoszeniem wraz z autorem i czasem. Opcjonalnie
  (`/konfiguracja rekrutacja ocena_wymagana:true`) bot nie pozwoli zaakceptować kandydata,
  dopóki akceptujący nie wystawi własnej oceny.
- **Po akceptacji**: automatyczne nadanie roli członka, zdjęcie roli gościa, wiadomość powitalna
  na wskazanym kanale i powiadomienie kandydata w DM. Odrzucenie prosi o powód (trafia do kandydata).
- **Zabezpieczenia**: blokada duplikatów zgłoszeń, konfigurowalny odstęp po odrzuceniu,
  zamykanie/otwieranie rekrutacji, informacja gdy kandydat opuści serwer z otwartym zgłoszeniem.

### 2. Role i uprawnienia

- **Automatyczna rola dla nowych** — każdy nowy użytkownik dostaje rolę *Gość* (bez dostępu do kanałów klanowych).
- **Hierarchia stopni** — Rekrut → Członek → Weteran → Officer (dowolna liczba poziomów, konfigurowalna).
- **`/setup`** — tworzy role, kategorie i kanały wraz z **permission overwrites** na kategoriach i kanałach,
  ustawia kolejność ról i zapisuje całą konfigurację w bazie. Istniejące role/kanały o tych samych nazwach
  są używane ponownie — nic nie jest usuwane.
- **Zarządzanie rolami** — `/rola nadaj`, `/rola odbierz`, `/rola awans`, `/rola degraduj`
  z pełną kontrolą hierarchii (nie da się nadać roli wyższej niż własna ani wyższej niż rola bota).

### 3. Moderacja

- `/kick`, `/ban` (także **czasowy**, przetrwa restart bota), `/timeout`, `/warn`.
- **Rejestr ostrzeżeń per użytkownik** — `/ostrzezenia lista|usun|wyczysc`, z historią usuniętych wpisów.
- **Log moderacji** na dedykowanym kanale — każda akcja dostaje kolejny numer sprawy.
- **Powiadomienia DM** dla ukaranego użytkownika (z informacją, czy dotarły).
- **Automoderacja** — filtr wulgaryzmów (odporny na leetspeak i polskie znaki), linków (z whitelistą domen),
  zaproszeń na inne serwery i spamu. Reakcja: usunięcie / ostrzeżenie / wyciszenie. Role zwolnione z filtrów.

### 4. Ekonomia klanowa

- **Waluta per serwer** — nazwa i emoji do ustawienia (`/ekonomia ustaw nazwa_waluty:Kredyty emoji_waluty:💎`),
  konto zakładane automatycznie przy pierwszym użyciu (z konfigurowalnym saldem startowym).
- **Zarobek za aktywność** — punkty za wiadomości (z cooldownem antyspamowym liczonym od ostatniej nagrody)
  oraz za minuty na kanałach głosowych (pomijani są boci, kanał AFK, osoby wyciszone i samotne na kanale).
- **Ręczne korekty** — `/dodaj-punkty`, `/odejmij-punkty` (saldo nigdy nie schodzi poniżej zera).
- **Przelewy** — `/przelej @osoba kwota [powód]` z walidacją salda i minimalnej kwoty.
- **Pełna księga transakcji** — każda zmiana salda ma wpis w bazie (kto, komu, ile, kiedy, za co).
  `/ekonomia historia` pokazuje operacje, `/ekonomia cofnij id:<numer>` odwraca nadużycie i zwraca punkty
  (gdy odbiorca zdążył część wydać, odzyskiwana jest kwota możliwa do pobrania — z informacją o tym).
- **Ranking** — `/ranking` po saldzie, łącznych zarobkach, czasie na kanałach głosowych lub liczbie wiadomości,
  z Twoją własną pozycją.
- **Sklep klanowy** — `/sklep` z przedmiotami konfigurowanymi przez adminów: rola na stałe, **rola czasowa**
  (zdejmowana automatycznie po upływie czasu) lub przedmiot własny realizowany ręcznie. Limity sztuk,
  zakup przyciskiem z potwierdzeniem, a przy nieudanym nadaniu roli punkty wracają na konto.

### 5. Logi zdarzeń

- **Siedem kategorii**, każda z własnym kanałem (albo wszystkie na jeden — `/logi wszystko`):
  💬 wiadomości (usunięte, edytowane, masowe czyszczenie), 🚪 członkowie (wejścia, wyjścia, bany,
  pseudonimy, wyciszenia), 🛡️ role (nadane i odebrane członkom, zmiany ról serwera wraz z uprawnieniami),
  🔊 kanały głosowe (wejścia, wyjścia, przenosiny), 📁 kanały, ⚙️ serwer, 💰 ekonomia
  (przelewy, ręczne korekty, zakupy, cofnięte transakcje).
- **Kto to zrobił** — bot sięga do dziennika audytu, żeby dopisać sprawcę usunięcia wiadomości,
  bana czy zmiany roli (wymaga uprawnienia *Wyświetlanie dziennika audytu*).
- **Bez duplikatów** — akcje wykonane komendami bota (`/ban`, `/timeout`) trafiają do logu moderacji,
  a odpowiadające im zdarzenia z bramy Discorda są pomijane. Ręczny ban z poziomu Discorda logowany jest normalnie.
- **Wykluczenia** — `/logi ignoruj dodaj kanal:#spam rola:@Bot uzytkownik:@Ktoś` wycisza wybrane źródła.
- **`/logi test`** — sprawdza konfigurację i uprawnienia bez czekania na prawdziwe zdarzenie.
- **Logi procesu do pliku** — opcjonalnie (`LOG_TO_FILE=true`) bot pisze też do `logs/bot-RRRR-MM-DD.log`
  z rotacją dzienną i automatycznym kasowaniem plików starszych niż `LOG_RETENTION_DAYS`.

### 6. Komendy ogólne

- `/stats` — członkowie, aktywność (24 h / 7 dni / 30 dni + wykres tygodniowy), rekrutacja,
  hierarchia z liczbą osób, ranking najaktywniejszych, ekonomia, struktura serwera, statystyki moderacji.
- `/profil` — status w klanie, ranga, data dołączenia, aktywność, saldo, ostrzeżenia, zgłoszenie rekrutacyjne, role.
- `/pomoc` — lista wszystkich komend.

---

## Wymagania

| Element | Wersja |
|---|---|
| Node.js | 18.18+ (zalecane 20 LTS lub nowsze) |
| discord.js | 14.27+ (Components V2) |
| Baza danych | SQLite (`better-sqlite3`) — plik tworzy się sam |

---

## Instalacja

```bash
git clone https://github.com/ServerGunnik/NL_Bot.git
cd NL_Bot
npm install
cp .env.example .env      # uzupełnij token i CLIENT_ID
npm run deploy            # rejestracja komend slash
npm start
```

### Plik `.env`

```ini
DISCORD_TOKEN=token_twojego_bota
CLIENT_ID=id_aplikacji
GUILD_ID=                 # opcjonalnie: ID serwera testowego (komendy widoczne natychmiast)
DATABASE_PATH=./data/nlbot.db
LOG_LEVEL=info            # error | warn | info | debug
LOG_TO_FILE=false         # zapis logów bota do logs/bot-RRRR-MM-DD.log
LOG_DIR=./logs
LOG_RETENTION_DAYS=14     # po ilu dniach kasować stare pliki logów
ENABLE_PRESENCE_INTENT=false
OWNER_IDS=                # opcjonalnie: ID osób z pełnym dostępem, po przecinku
```

> `npm run deploy` bez `GUILD_ID` rejestruje komendy globalnie (propagacja do ~1 h).
> Z `GUILD_ID` komendy pojawiają się na wskazanym serwerze od razu — wygodne przy testach.
> `npm run deploy:clear` usuwa zarejestrowane komendy.

---

## Konfiguracja aplikacji Discord

1. [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. **Bot** → *Reset Token* → skopiuj token do `.env`.
3. **Bot → Privileged Gateway Intents** — włącz:
   - ✅ **Server Members Intent** (automatyczna rola dla nowych, statystyki)
   - ✅ **Message Content Intent** (automoderacja, licznik aktywności, nagrody za czat)
   - ⬜ *Presence Intent* — tylko jeśli chcesz licznik „online” w `/stats`
     (wtedy ustaw też `ENABLE_PRESENCE_INTENT=true`)
4. Zaproś bota (podmień `CLIENT_ID`):

```
https://discord.com/api/oauth2/authorize?client_id=CLIENT_ID&permissions=1099780418774&scope=bot%20applications.commands
```

Uprawnienia w linku: zarządzanie rolami i kanałami, kick, ban, wyciszanie, wysyłanie i usuwanie wiadomości,
historia wiadomości, reakcje, log audytu.

5. **Ważne:** w ustawieniach serwera przesuń rolę bota **nad** role, którymi ma zarządzać
   (Gość, Rekrut, Członek, Weteran, Officer). Bez tego Discord nie pozwoli mu ich nadawać.

---

## Pierwsze uruchomienie na serwerze

```
/setup
```

Pokaże podgląd planu i po potwierdzeniu utworzy:

| Element | Zawartość |
|---|---|
| Role | Gość, Rekrut (1), Członek (2), Weteran (3), Officer (4) |
| 🏰 KLAN | `ogloszenia-klanu` (pisze Officer), `powitania`, `czat-klanowy`, `weterani` (od Weterana), kanał głosowy |
| 📋 REKRUTACJA | `rekrutacja` — publiczny, tylko do czytania, z panelem zgłoszeń |
| 🛡️ ADMINISTRACJA | `zgloszenia`, `logi-moderacji`, `logi-serwera`, `czat-kadry` — tylko Officer |

`/setup` zapisuje też w bazie: rolę startową, rolę członka, kanał zgłoszeń, kanał logów moderacji i kanał powitań,
kieruje wszystkie kategorie logów zdarzeń na `#logi-serwera`, wgrywa domyślne zestawy pytań — formularz
kandydata i ankietę rekrutera (jeśli są puste) — i publikuje panel rekrutacji.

Ręczna konfiguracja (zamiast lub po `/setup`):

```
/konfiguracja kanal typ:zgloszenia kanal:#zgloszenia
/konfiguracja rola  typ:gosc      rola:@Gość
/konfiguracja rola  typ:czlonek   rola:@Członek
/konfiguracja powitanie tekst:Witaj {user} w klanie {server}!
/pytania panel
/pytania domyslne typ:reviewer
/rekrutacja-panel kanal:#rekrutacja
/konfiguracja pokaz
/logi wszystko kanal:#logi-serwera
```

Placeholdery w wiadomości powitalnej: `{user}`, `{user.name}`, `{user.id}`, `{server}`, `{memberCount}`.

### Włączenie ekonomii

```
/ekonomia ustaw wlaczona:true nazwa_waluty:Punkty klanowe emoji_waluty:🪙
/ekonomia ustaw nagroda_wiadomosc:2 cooldown_wiadomosc:60 nagroda_glosowa:1 min_osob_glosowy:2
/sklep dodaj nazwa:Kolor nicku cena:500 typ:role rola:@Kolor
/sklep dodaj nazwa:VIP na tydzień cena:1000 typ:temp_role rola:@VIP czas_godzin:168
/sklep opublikuj kanal:#sklep
```

Ekonomia jest domyślnie **wyłączona** — dopóki jej nie włączysz, punkty nie są naliczane,
a komendy ekonomiczne odpowiadają komunikatem o wyłączonej funkcji.

---

## Komendy

### Rekrutacja

| Komenda | Opis | Uprawnienia |
|---|---|---|
| `/rekrutacja` | Otwiera formularz zgłoszeniowy | wszyscy |
| `/rekrutacja-panel [kanal] [tytul] [opis]` | Publikuje panel z przyciskiem do formularza | Zarządzanie serwerem |
| `/pytania panel [typ]` | Interaktywny panel zarządzania pytaniami | Zarządzanie serwerem |
| `/pytania lista \| dodaj \| usun \| przesun \| domyslne \| wyczysc` | Zarządzanie pytaniami z poziomu komendy | Zarządzanie serwerem |
| `... typ:🧭 Ankieta rekrutera` | Ten sam zestaw komend dla pytań widocznych tylko dla administracji | Zarządzanie serwerem |
| `/konfiguracja rekrutacja ocena_wymagana:true` | Wymaga oceny rekrutera przed akceptacją | Zarządzanie serwerem |

### Role

| Komenda | Opis | Uprawnienia |
|---|---|---|
| `/rola nadaj <użytkownik> <rola>` | Nadaje rolę | Zarządzanie rolami |
| `/rola odbierz <użytkownik> <rola>` | Odbiera rolę | Zarządzanie rolami |
| `/rola awans <użytkownik>` | Awans o jeden stopień | Zarządzanie rolami |
| `/rola degraduj <użytkownik>` | Degradacja o jeden stopień | Zarządzanie rolami |
| `/rola hierarchia pokaz \| ustaw \| usun \| wyczysc` | Konfiguracja stopni klanowych | Zarządzanie rolami |
| `/setup` | Tworzy strukturę klanu (role, kanały, uprawnienia) | Administrator |

### Moderacja

| Komenda | Opis | Uprawnienia |
|---|---|---|
| `/kick <użytkownik> [powod]` | Wyrzuca z serwera | Wyrzucanie |
| `/ban <użytkownik> [powod] [usun_wiadomosci] [czas]` | Banuje (stale lub czasowo, np. `7d`) | Banowanie |
| `/timeout <użytkownik> <czas> [powod]` | Wycisza (`10m`, `2h`, `1d`, max `28d`; `0` zdejmuje) | Wyciszanie |
| `/warn <użytkownik> <powod>` | Ostrzeżenie zapisywane w rejestrze | Wyciszanie |
| `/ostrzezenia lista \| usun \| wyczysc` | Rejestr ostrzeżeń użytkownika | Wyciszanie |
| `/automod pokaz \| ustaw \| slowa \| wyjatki \| domeny` | Konfiguracja automoderacji | Zarządzanie serwerem |

### Logi

| Komenda | Opis | Uprawnienia |
|---|---|---|
| `/logi pokaz` | Konfiguracja wszystkich kategorii | Zarządzanie serwerem |
| `/logi kanal <kategoria> <kanał>` | Kanał dla jednej kategorii | Zarządzanie serwerem |
| `/logi wszystko <kanał>` | Wszystkie kategorie na jeden kanał | Zarządzanie serwerem |
| `/logi przelacz <kategoria> <wł/wył>` | Włącza lub wyłącza kategorię | Zarządzanie serwerem |
| `/logi test <kategoria>` | Testowy wpis — sprawdza uprawnienia | Zarządzanie serwerem |
| `/logi ignoruj dodaj \| usun` | Wykluczenia (kanał, rola, osoba) | Zarządzanie serwerem |
| `/logi wylacz-wszystko` | Kasuje konfigurację logów | Zarządzanie serwerem |

### Ekonomia

| Komenda | Opis | Uprawnienia |
|---|---|---|
| `/saldo [użytkownik]` | Stan konta (cudze saldo tylko dla administracji) | wszyscy |
| `/przelej <użytkownik> <kwota> [powód]` | Przelew punktów | wszyscy |
| `/ranking [typ]` | Ranking: punkty, zarobione, czat, kanały głosowe | wszyscy |
| `/sklep pokaz \| kup \| moje` | Oferta sklepu, zakup, własne zakupy | wszyscy |
| `/sklep dodaj \| edytuj \| usun \| opublikuj` | Zarządzanie sklepem | Zarządzanie serwerem |
| `/dodaj-punkty <użytkownik> <kwota>` | Przyznanie punktów | Zarządzanie serwerem |
| `/odejmij-punkty <użytkownik> <kwota>` | Odjęcie punktów | Zarządzanie serwerem |
| `/ekonomia pokaz \| ustaw` | Konfiguracja waluty i nagród | Zarządzanie serwerem |
| `/ekonomia historia [użytkownik]` | Księga transakcji | Zarządzanie serwerem |
| `/ekonomia cofnij <id>` | Cofnięcie transakcji (nadużycia) | Zarządzanie serwerem |
| `/ekonomia reset` | Kasuje salda i historię | Zarządzanie serwerem |

### Ogólne

| Komenda | Opis |
|---|---|
| `/stats` | Statystyki serwera i aktywność |
| `/profil [użytkownik]` | Profil członka klanu |
| `/pomoc` | Lista komend |
| `/konfiguracja pokaz \| kanal \| rola \| powitanie \| rekrutacja \| reset` | Ustawienia serwera *(Zarządzanie serwerem)* |

---

## Struktura projektu

```
src/
├── index.js                  # start bota: klient, intenty, ładowanie modułów
├── config.js                 # konfiguracja procesu (.env)
├── deploy-commands.js        # rejestracja komend slash w API
│
├── commands/                 # każda komenda = osobny plik { data, execute }
│   ├── admin/                #   /setup /konfiguracja /pytania /rola /automod /rekrutacja-panel
│   ├── moderation/           #   /kick /ban /timeout /warn /ostrzezenia
│   ├── economy/              #   /saldo /przelej /dodaj-punkty /odejmij-punkty /ranking /sklep /ekonomia
│   └── general/              #   /rekrutacja /stats /profil /pomoc
│
├── events/                   # event handlery { name, once, execute }
│   ├── ready.js              #   presence, scheduler banów czasowych
│   ├── interactionCreate.js  #   router: komendy, przyciski, modale, selecty, autocomplete
│   ├── guildMemberAdd.js     #   automatyczna rola dla nowych
│   ├── guildMemberRemove.js  #   informacja o kandydacie, który odszedł
│   ├── guildCreate.js        #   powitanie na nowym serwerze
│   └── messageCreate.js      #   automoderacja + licznik aktywności
│
├── interactions/             # handlery komponentów wg namespace w customId
│   ├── buttons/              #   rekrutacja, pytania, setup, sklep
│   ├── modals/               #   rekrutacja, pytania
│   └── selects/              #   pytania
│
├── handlers/                 # ładowanie komend, eventów i komponentów
├── services/                 # logika domenowa (rekrutacja, moderacja, automod, setup, ekonomia, sklep, logi)
├── database/
│   ├── index.js              #   połączenie SQLite + wykonanie schematu i migracji
│   ├── schema.sql            #   definicje tabel
│   ├── migrations.js         #   dodawanie brakujących kolumn w istniejących bazach
│   └── repositories/         #   guilds, recruitment, roles, moderation, activity, economy, shop, logs
├── ui/components.js          # buildery Components V2 (panel, section, row, button)
└── utils/                    # logger (konsola + plik), uprawnienia, log moderacji, formatowanie, customId

tests/                        # testy (node --test)
```

**Identyfikatory komponentów** mają format `namespace:action:arg1`, np. `rekrutacja:accept:42`.
Router (`events/interactionCreate.js`) wybiera handler po `namespace`, resztę przekazuje jako argumenty —
dzięki temu dodanie nowego przycisku to jeden plik w `src/interactions/`.

---

## Baza danych

SQLite (WAL) — plik tworzony automatycznie przy pierwszym starcie, schemat wykonywany idempotentnie.

| Tabela | Zawartość |
|---|---|
| `guild_settings` | pełna konfiguracja serwera: kanały, role, rekrutacja, automoderacja |
| `recruitment_questions` | pytania obu zestawów (kolumna `audience`: kandydat / rekruter) |
| `application_reviews` | oceny kandydata wystawiane przez rekruterów (jedna na rekrutera) |
| `applications` | zgłoszenia wraz z odpowiedziami (JSON), statusem i decyzją |
| `role_hierarchy` | mapowanie rola → poziom w hierarchii klanu |
| `warnings` | ostrzeżenia per użytkownik (z historią usuniętych) |
| `mod_cases` | rejestr akcji moderacyjnych z numeracją per serwer |
| `blocked_words` | lista zabronionych słów |
| `temp_bans` | bany czasowe zdejmowane przez scheduler |
| `member_activity`, `activity_daily` | aktywność członków i serwera |
| `economy` | konta walutowe: saldo, zarobki, wydatki, czas na kanałach głosowych, cooldowny |
| `economy_transactions` | pełna księga: typ, nadawca, odbiorca, kwota, powód, cofnięcia |
| `shop_items`, `shop_purchases` | przedmioty sklepu i historia zakupów (z terminami ról czasowych) |
| `log_settings` | kanał i stan każdej kategorii logów zdarzeń |
| `log_ignores` | kanały, role i osoby wykluczone z logowania |

Każda tabela jest kluczowana po `guild_id` — ustawienia jednego serwera nigdy nie wyciekają do innego.
Warstwa dostępu do danych jest odseparowana w `src/database/repositories/` (żadnego SQL-a w komendach),
a zapisy ustawień przechodzą przez listę dozwolonych kolumn.

Nowe kolumny dodawane w kolejnych wersjach bota trafiają do istniejących baz automatycznie
(`src/database/migrations.js` — idempotentne `ALTER TABLE`, uruchamiane przy starcie).

Kopia zapasowa: wystarczy skopiować plik `data/nlbot.db`.

---

## Components V2

```js
const { panel, row, button, V2_FLAGS } = require('./ui/components');

await channel.send({
  components: [
    panel({
      title: '🏰 Rekrutacja',
      description: 'Kliknij, aby wypełnić formularz.',
      fields: [{ name: 'Status', value: 'otwarta', inline: true }],
      rows: [row(button({ id: 'rekrutacja:start', label: 'Wypełnij', style: 'success' }))],
      footer: 'Odpowiedź dostaniesz w DM',
    }),
  ],
  flags: V2_FLAGS,          // MessageFlags.IsComponentsV2
  allowedMentions: { parse: [] },
});
```

Uwagi praktyczne (pilnowane przez testy w `tests/components.test.js`):

- flaga `IsComponentsV2` **wyklucza** pola `content` i `embeds`,
- limit to **40 komponentów** i **4000 znaków** na wiadomość — karty zgłoszeń dzielą budżet znaków
  po równo między odpowiedzi kandydata,
- modale korzystają z komponentów `Label` (etykieta do 45 znaków, opis do 100),
- Discord pozwala na maksymalnie **5 pól w modalu** — tyle też wynosi limit pytań rekrutacyjnych.

---

## Testy

```bash
npm test
```

147 testów (`node --test`) pokrywa: repozytoria i izolację danych między serwerami, logikę rekrutacji
(cooldown, duplikaty, decyzje, rozdział zestawów pytań, oceny rekruterów i wymóg oceny przed
akceptacją), hierarchię ról, ostrzeżenia i numerację spraw, automoderację
(leetspeak, granice słów, whitelista domen, próg spamu), ekonomię (bilansowanie punktów, cofanie
transakcji częściowe i pełne, cooldowny, ranking), sklep (zakupy, limity sztuk, zwrot punktów przy
nieudanym nadaniu roli, role czasowe), logi zdarzeń (kategorie, wykluczenia, wysyłka, znaczniki akcji
bota chroniące przed podwójnym wpisem), limity Components V2, payloady komend slash oraz uprawnienia.

Testy w `tests/commands-execute.test.js` wykonują komendy end-to-end na prawdziwym resolverze opcji
discord.js — to on wyłapuje błędy typu „`getBoolean()` na opcji tekstowej”. Każdy przebieg używa
własnej, tymczasowej bazy i nie dotyka `data/`.

---

## Rozwijanie bota

**Nowa komenda** — plik w `src/commands/<grupa>/`:

```js
const { InteractionContextType, SlashCommandBuilder } = require('discord.js');
const { reply } = require('../../ui/components');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('przyklad')
    .setDescription('Opis komendy')
    .setContexts(InteractionContextType.Guild),
  cooldown: 5,                                   // opcjonalnie, w sekundach
  async execute(interaction) {
    return reply.success(interaction, 'Działa!');
  },
};
```

Po dodaniu uruchom `npm run deploy`.

**Nowy przycisk / modal / select** — plik w `src/interactions/<typ>/` eksportujący
`{ namespace, execute(interaction, { action, args }) }`; `customId` buduj helperem
`require('../../utils/customId').build('namespace', 'action', id)`.

**Nowy event** — plik w `src/events/` eksportujący `{ name: Events.X, once?, execute }`.

---

## Najczęstsze problemy

| Objaw | Przyczyna i rozwiązanie |
|---|---|
| Bot nie nadaje ról | Rola bota jest niżej niż rola nadawana — przesuń ją wyżej w ustawieniach serwera |
| Nowi nie dostają roli | Brak *Server Members Intent* albo nieustawiona rola gościa (`/konfiguracja rola typ:gosc`) |
| Automoderacja nie reaguje | Brak *Message Content Intent*, wyłączony filtr (`/automod pokaz`) lub rola na liście wyjątków |
| Komendy nie widać | Uruchom `npm run deploy`; globalne komendy propagują się do ~1 h (użyj `GUILD_ID` do testów) |
| „Nie mam uprawnień do pisania na kanale” | Nadaj botowi *Wyświetlanie kanału* i *Wysyłanie wiadomości* na tym kanale |
| Kandydat nie dostaje DM | Ma wyłączone wiadomości prywatne — bot informuje o tym w potwierdzeniu decyzji |
| Brak przycisku *Wypełnij ocenę* | Zestaw rekrutera jest pusty — dodaj pytania (`/pytania domyslne typ:reviewer`); przycisk pojawia się na nowych i odświeżonych kartach |
| `/stats` nie pokazuje online | Włącz *Presence Intent* i ustaw `ENABLE_PRESENCE_INTENT=true` |
| Punkty się nie naliczają | Ekonomia wyłączona (`/ekonomia pokaz`), nagroda ustawiona na 0 albo trwa cooldown |
| Brak punktów za kanał głosowy | Na kanale musi być min. tyle osób, ile ustawia `min_osob_glosowy`; osoby wyciszone i kanał AFK są pomijane |
| Rola czasowa nie znika | Bot musi działać w momencie wygaśnięcia (sprawdza co minutę) i mieć rolę wyżej w hierarchii |
| Brak logów zdarzeń | Sprawdź `/logi pokaz` i uruchom `/logi test <kategoria>` — powie, czy problem to brak kanału, wyłączona kategoria czy uprawnienia |
| W logach brakuje sprawcy | Bot potrzebuje uprawnienia *Wyświetlanie dziennika audytu*; Discord nie zapisuje w nim wszystkich zdarzeń |
| Treść usuniętej wiadomości „niedostępna" | Wiadomość była starsza niż pamięć podręczna bota — Discord nie udostępnia treści po restarcie |

---

## Licencja

MIT
