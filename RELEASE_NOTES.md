Erste stabile Version der **Umweltkarte** für Home Assistant mit dem Layout **Lesbare Zeilen**.

- Drei übersichtliche Zeilen für Luftqualität, UV und Pollen; Antippen öffnet die Sensordetails.
- UV-Tagesverlauf mit Jetzt-Markierung und Stundenwerten beim Tippen, per Maus oder mit den Pfeiltasten.
- Keine zusätzlichen Mushroom-, ApexCharts- oder card-mod-Abhängigkeiten.
- Darstellung folgt dem vorhandenen Home-Assistant-Theme.
- Prüft Quellenstatus, Prognosedatum und Alter der UV-Prognose. Unvollständige Pollendaten bleiben sichtbar gekennzeichnet.

In HACS als benutzerdefiniertes Repository vom Typ **Dashboard** hinzufügen. Die vollständige Installation und Karten-YAML stehen in der README.

Die Karte verwendet vorhandene Sensoren. Sie installiert keine Datenquellen und erstellt keine neuen Sensoren.
