# Fork von calumhrmurray/lectern

Florians Fork. `origin` ist der Fork (wuesten-fuchs/lectern), `upstream` das Original.

## Was der Fork anders macht

- **Folienleiste unten links:** Der erste Knopf in der Leiste unten links blendet die Folienübersicht ein und aus, auch im Quiet-Modus, ohne Toolbar und Inspector. Löschen per Rechtsklick auf ein Vorschaubild oder mit ⌫. (`App.toggleSlideStrip`, CSS `.lec-slide-strip`, Icon `slides` aus Lucide)
- **Vorschaubilder ohne Versatz:** reveal schreibt Folien, die es gerade nicht zeigt, ein `top` von halber Folienhöhe. Die Vorschau rechnet das nach dem Laden neu (`ThumbnailRenderer.recenterOnLoad`).

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
