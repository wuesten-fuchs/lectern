# Fork von calumhrmurray/lectern

Florians Fork. `origin` ist der Fork (wuesten-fuchs/lectern), `upstream` das Original.

## Was der Fork anders macht

- **Folienleiste unten links:** Der erste Knopf in der Leiste unten links blendet die Folienübersicht ein und aus, auch im Quiet-Modus, ohne Toolbar und Inspector. Löschen per Rechtsklick auf ein Vorschaubild oder mit ⌫. (`App.toggleSlideStrip`, CSS `.lec-slide-strip`, Icon `slides` aus Lucide)
- **Hell oder dunkel wie macOS:** Der Editor folgt der Systemeinstellung und wechselt live mit. Ein Klick neben die Folie schaltet nicht mehr um. (`App.systemDark`)
- **Vorschaubilder ohne Versatz:** reveal schreibt Folien, die es gerade nicht zeigt, ein `top` von halber Folienhöhe. Die Vorschau rechnet das nach dem Laden neu (`ThumbnailRenderer.recenterOnLoad`).
- **Folie löschen und Rückgängig ohne Wartezeit:** Die Folienleiste behält bei jeder Änderung an der Folienfolge die Vorschaubilder aller Folien, die gleich geblieben sind (Schlüssel: uid der Folie), und rendert nur neue oder geänderte, die sichtbaren sofort statt nach 200 ms. Die Übersicht (`M`) baut sich nur noch auf, wenn sie offen ist. Rückgängig einer Änderung an der Folienfolge (Löschen, Einfügen, Verschieben) ersetzt im Canvas nur die Folien, die sich geändert haben, statt alle neu aufzubauen; die übrigen behalten, was das Deck per Skript hineingezeichnet hat (Diagramme). Gemessen auf der Masterpräsentation (58 Folien): Löschen von rund 260 ms auf rund 10 ms, Rückgängig von rund 250 ms auf rund 30 ms. (`Navigator.render`, `MapView.render`, `DeckDocument.restore`, `Editor.restore`, `Stage.restoreLive`)

Fork-Stellen im Code tragen den Kommentar `Fork:`.

## Neue Commits vom Original übernehmen

```
cd ~/Github/lectern
git fetch upstream
git merge upstream/main
```

`Lectern.html` ist ein Build-Ergebnis und kollidiert beim Merge fast immer. Dann nicht von Hand auflösen, sondern neu bauen:

```
git checkout --theirs Lectern.html
npm ci && npm run build && npm test
git add Lectern.html && git commit
```

## Starten

```
node ~/Github/lectern/cli/index.js <ordner-oder-deck.html>
```
