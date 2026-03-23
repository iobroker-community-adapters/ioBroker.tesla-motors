/*global systemDictionary:true */
"use strict";

systemDictionary = {
    "tesla-motors adapter settings": {
        en: "Adapter settings for tesla-motors",
        de: "Adaptereinstellungen für tesla-motors",
    },

    // ── Step 1 ───────────────────────────────────────────────────────
    "Step 1: Generate Key Pair": {
        en: "Step 1: Generate Key Pair",
        de: "Schritt 1: Schlüsselpaar generieren",
    },
    "step1_instruction1": {
        en: "Click \"Generate Key Pair\" below to create an EC key pair (prime256v1)",
        de: "Klicke unten auf \"Schlüsselpaar generieren\" um ein EC-Schlüsselpaar (prime256v1) zu erstellen",
    },
    "step1_instruction2": {
        en: "Copy the Public Key and go to <a href=\"https://fleetkey.net\" target=\"_blank\">fleetkey.net</a> - create an account and get your subdomain (e.g. abc123.fleetkey.net)",
        de: "Kopiere den Public Key und gehe zu <a href=\"https://fleetkey.net\" target=\"_blank\">fleetkey.net</a> - erstelle ein Konto und erhalte deine Subdomain (z.B. abc123.fleetkey.net)",
    },
    "step1_instruction3": {
        en: "Upload the Public Key to your FleetKey.net account. Tesla will download the key from there during registration.",
        de: "Lade den Public Key in dein FleetKey.net Konto hoch. Tesla lädt den Key von dort während der Registrierung herunter.",
    },
    "Generate Key Pair": {
        en: "Generate Key Pair",
        de: "Schlüsselpaar generieren",
    },
    "Copy Public Key": {
        en: "Copy Public Key",
        de: "Public Key kopieren",
    },
    "Public Key (copy to FleetKey.net)": {
        en: "Public Key (copy to FleetKey.net)",
        de: "Public Key (auf FleetKey.net kopieren)",
    },

    // ── Step 2 ───────────────────────────────────────────────────────
    "Step 2: Tesla Developer App": {
        en: "Step 2: Tesla Developer App",
        de: "Schritt 2: Tesla Developer App",
    },
    "step2_instruction1": {
        en: "Create a Fleet API Application at ",
        de: "Erstelle eine Fleet API Application auf ",
    },
    "step2_instruction2": {
        en: "Origin: https://&lt;your-subdomain&gt;.fleetkey.net (your full FleetKey subdomain, e.g. https://abc123.fleetkey.net)",
        de: "Origin: https://&lt;deine-subdomain&gt;.fleetkey.net (deine volle FleetKey Subdomain, z.B. https://abc123.fleetkey.net)",
    },
    "step2_instruction3": {
        en: "Redirect URL: https://auth.tesla.com/void/callback",
        de: "Redirect URL: https://auth.tesla.com/void/callback",
    },
    "step2_instruction4": {
        en: "Copy Client ID and Client Secret from the created app and enter them below together with your FleetKey domain",
        de: "Kopiere Client ID und Client Secret von der erstellten App und trage sie unten zusammen mit deiner FleetKey Domain ein",
    },
    "Client ID": {
        en: "Client ID",
        de: "Client ID",
    },
    "Client Secret": {
        en: "Client Secret",
        de: "Client Secret",
    },
    "Region (Fallback)": {
        en: "Region (Fallback, auto-detected from token)",
        de: "Region (Fallback, wird automatisch aus Token erkannt)",
    },
    "FleetKey Domain": {
        en: "FleetKey Domain (e.g. abc123.fleetkey.net)",
        de: "FleetKey Domain (z.B. abc123.fleetkey.net)",
    },

    // ── Step 3 ───────────────────────────────────────────────────────
    "Step 3: Authentication": {
        en: "Step 3: Authentication",
        de: "Schritt 3: Authentifizierung",
    },
    "step3_instruction1": {
        en: "Click \"Generate Auth Link\" - a new browser tab opens with the Tesla login page",
        de: "Klicke auf \"Auth-Link generieren\" - ein neuer Browser-Tab öffnet sich mit der Tesla-Login-Seite",
    },
    "step3_instruction2": {
        en: "Log in with your Tesla account and authorize the app",
        de: "Melde dich mit deinem Tesla-Konto an und autorisiere die App",
    },
    "step3_instruction3": {
        en: "After login you will see \"Page Not Found\" - this is expected! Copy the complete URL from the browser address bar",
        de: "Nach dem Login erscheint \"Page Not Found\" - das ist korrekt! Kopiere die komplette URL aus der Browser-Adresszeile",
    },
    "step3_instruction4": {
        en: "Paste the URL into the field below and click \"Save and close\"",
        de: "Füge die URL in das Feld unten ein und klicke auf \"Speichern und schließen\"",
    },
    "step3_warning": {
        en: "Never share this URL with anyone! It grants access to your Tesla account.",
        de: "Teile diese URL niemals mit anderen Personen! Sie erlaubt Zugang zu deinem Tesla-Konto.",
    },
    "Generate Auth Link": {
        en: "Generate Auth Link",
        de: "Auth-Link generieren",
    },

    // ── Step 4 ───────────────────────────────────────────────────────
    "Step 4: Install Virtual Key": {
        en: "Step 4: Install Virtual Key",
        de: "Schritt 4: Virtual Key installieren",
    },
    "step4_description": {
        en: "The Virtual Key is required to send commands to your vehicle (lock/unlock, climate, charging, etc.). Without it, you can only read vehicle data. You can do this step after the adapter is running.",
        de: "Der Virtual Key wird benötigt um Kommandos an dein Fahrzeug zu senden (Ver-/Entriegeln, Klima, Laden, etc.). Ohne ihn kannst du nur Fahrzeugdaten lesen. Dieser Schritt kann nach dem Start des Adapters durchgeführt werden.",
    },
    "step4_instruction1": {
        en: "Open the URL below on your phone in the Tesla App, or scan the QR code with your phone camera",
        de: "Öffne die URL unten auf deinem Handy in der Tesla App, oder scanne den QR-Code mit der Handy-Kamera",
    },
    "step4_instruction2": {
        en: "The Tesla App will ask you to confirm adding a \"third-party key\"",
        de: "Die Tesla App fragt dich ob du einen \"Drittanbieter-Schlüssel\" hinzufügen möchtest",
    },
    "step4_instruction3": {
        en: "Go to your vehicle and hold your key card to the center console to confirm the installation",
        de: "Gehe zu deinem Fahrzeug und halte deine Schlüsselkarte an die Mittelkonsole um die Installation zu bestätigen",
    },
    "step4_url_label": {
        en: "Virtual Key URL:",
        de: "Virtual Key URL:",
    },
    "step4_qr_hint": {
        en: "Scan this QR code with your phone to open the URL directly in the Tesla App",
        de: "Scanne diesen QR-Code mit deinem Handy um die URL direkt in der Tesla App zu öffnen",
    },

    // ── Update Settings ──────────────────────────────────────────────
    "Update Settings": {
        en: "Update Settings",
        de: "Update Einstellungen",
    },
    "Update interval in seconds (minimum 10)": {
        en: "Update interval in seconds (minimum 10)",
        de: "Update Intervall in Sekunden (Minimum 10)",
    },
    "Location update interval in seconds (0 = disabled)": {
        en: "Location update interval in seconds (0 = disabled)",
        de: "Standort Update Intervall in Sekunden (0 = deaktiviert)",
    },
    "Update interval while driving in seconds (0 = disabled)": {
        en: "Update interval while driving in seconds (0 = disabled)",
        de: "Update Intervall während der Fahrt in Sekunden (0 = deaktiviert)",
    },

    // ── Options ──────────────────────────────────────────────────────
    "Options": {
        en: "Options",
        de: "Optionen",
    },
    "Wake up vehicle for each update (prevents sleep to save battery)": {
        en: "Wake up vehicle for each update (prevents sleep to save battery)",
        de: "Fahrzeug für jedes Update aufwecken (verhindert Schlafmodus zum Batterie sparen)",
    },
    "Reset Login/Token Information": {
        en: "Reset Login/Token Information",
        de: "Login/Token Informationen zurücksetzen",
    },
    "Exclude device IDs (comma separated)": {
        en: "Exclude device IDs (comma separated)",
        de: "Geräte-IDs ausschließen (kommagetrennt)",
    },
    "Exclude objects for update (comma separated)": {
        en: "Exclude objects for update (comma separated)",
        de: "Objekte vom Update ausschließen (kommagetrennt)",
    },
};
