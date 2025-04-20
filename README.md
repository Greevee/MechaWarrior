# MechaWarrior Autobattler PoC

Dies ist ein Proof of Concept (PoC) für ein Autobattler-Spiel, inspiriert von Titeln wie Mechabellum. Das Hauptziel dieses Projekts ist das Sammeln von Erfahrungen mit relevanten Technologien und Konzepten der Spieleentwicklung in diesem Genre.

## Aktueller Stand & Features

Das Projekt befindet sich in einem frühen Entwicklungsstadium, implementiert aber bereits einige Kernsysteme:

*   **Spielablauf:** Ein grundlegender Spielzyklus aus Vorbereitungsphase (`Preparation`) und Kampfphase (`Combat`) existiert. Runden werden gezählt.
*   **Client-Server-Architektur:** Nutzt Node.js mit TypeScript und Socket.IO für die Serverlogik und Echtzeitkommunikation. Der Client ist eine React-Anwendung (ebenfalls TypeScript).
*   **Einheiten:**
    *   Mehrere Einheitentypen (`human_infantry`, `human_small_tank`, `human_catapult`, `human_moloch`) mit unterschiedlichen Werten (HP, Rüstung, Kosten etc.).
    *   Unterstützung für Boden- und Lufteinheiten (`isAirUnit`).
    *   Einheiten können aus mehreren Figuren bestehen (`squadSize`).
*   **Platzierung:**
    *   Einheiten können während der Vorbereitungsphase auf einem Grid platziert werden.
    *   Platzierung ist auf Zonen pro Spieler beschränkt.
    *   Rotation (0/90 Grad) bei der Platzierung wird unterstützt.
    *   Einheiten haben Platzierungskosten und es gibt ein Limit pro Runde.
*   **Kampf:**
    *   Einheiten finden automatisch Ziele und greifen an.
    *   Mehrere Waffentypen mit unterschiedlichen Eigenschaften (Schaden, Reichweite, Angriffsgeschwindigkeit, Splash, Projektiltyp).
    *   Unterstützung für direkte (`targeted`) und ballistische (`ballistic`) Projektile.
    *   Einheiten erleiden Schaden und werden bei 0 HP entfernt.
*   **Visualisierung (Client):**
    *   2D-Sprites in einer 3D-Umgebung mittels `react-three-fiber` und `drei`.
    *   Billboarding für Einheiten-Sprites.
    *   Visuelle Darstellung von Projektilen (Linien oder Bilder).
    *   Impact-Effekte (Sprites) mit Skalierung beim Einschlag.
    *   Animationen: Rückstoß (`recoil`) beim Feuern, Auf/Ab-Bewegung (`bobbing`) im Idle- und Bewegungszustand.
    *   Gesundheitsbalken über den Einheiten.
    *   Einfache Umgebung (Bodenplane, Skybox).
*   **Audio:**
    *   Positionsabhängige Sounds (3D-Audio) für Waffenfeuer und Projektileinschläge (`PositionalAudio`).
    *   Hintergrundmusik während der Kampfphase.
    *   Fehler beim Laden von Sounddateien werden abgefangen und führen nicht zum Absturz.
*   **Benutzeroberfläche (UI):**
    *   Grundlegende HUD-Elemente zur Anzeige von Spieler-HP, Credits, Rundenzahl, Phase und verbleibender Zeit.
    *   Einheitenpool zur Auswahl und zum Freischalten von Einheiten.
    *   Anzeige von Details/Statistiken für ausgewählte Einheiten.
*   **State Management:**
    *   Serverseitig: Der Server verwaltet den maßgeblichen `GameState`.
    *   Clientseitig: Zustandssynchronisation und Verwaltung über `zustand`.

## Verwendete Technologien

*   **Backend:** Node.js, TypeScript, Socket.IO
*   **Frontend:** React, TypeScript, Vite, Three.js (`react-three-fiber`, `drei`), Zustand, CSS
*   **Allgemein:** UUID (zur ID-Generierung)

## Setup & Ausführen

1.  **Repository klonen:**
    ```bash
    git clone <repository-url>
    cd MechaWarrior 
    ```
2.  **Abhängigkeiten installieren:**
    *   Installiere die Abhängigkeiten im Hauptverzeichnis (falls vorhanden), im `server`-Verzeichnis und im `client`-Verzeichnis.
    ```bash
    # Im Hauptverzeichnis (falls nötig)
    npm install 
    # oder
    yarn install

    # Im Server-Verzeichnis
    cd server
    npm install
    # oder
    yarn install
    cd ..

    # Im Client-Verzeichnis
    cd client
    npm install
    # oder
    yarn install
    cd ..
    ```
3.  **Server starten:**
    ```bash
    cd server
    npm run dev 
    # oder ein anderes Start-Skript, falls definiert (z.B. npm start)
    ```
    Der Server sollte nun laufen (typischerweise auf Port 3000 oder einem anderen konfigurierten Port).

4.  **Client starten:**
    *   Öffne ein **neues** Terminalfenster.
    ```bash
    cd client
    npm run dev
    # oder ein anderes Start-Skript, falls definiert
    ```
    Der Client wird kompiliert und ein Entwicklungsserver gestartet (oft auf Port 5173 bei Vite).

5.  **Im Browser öffnen:**
    Öffne die im Terminal angezeigte Adresse für den Client (z.B. `http://localhost:5173`) in deinem Webbrowser. 