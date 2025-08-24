// generate-cards-json.mjs
// Usage (liste simple compatible index.html actuel):
//    node generate-cards-json.mjs
// Usage (mode objets riche: ajoute element + name):
//    node generate-cards-json.mjs --mode=objects
//
// Prérequis: Node 16+
// Structure attendue:
//   cartes/
//     Air/....png
//     Eau/....jpg
//     Feu/....webp
//     Vegetal/....png  (ou Végétal/)
//     Mineral/....png  (ou Minéral/)
//     Arcane/....png

import { promises as fs } from "fs";
import path from "path";

const ROOT_DIR = process.cwd();
const CARDS_DIR = path.join(ROOT_DIR, "cartes");
const OUTPUT = path.join(ROOT_DIR, "cards.json");
const VALID_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

// si --mode=objects alors on écrit [{path, element, name}], sinon ["cartes/Element/file.png", ...]
const MODE_OBJECTS = process.argv.some(a => a === "--mode=objects");

// Normalisations pour l'élément depuis le nom du sous-dossier
function normElement(dir) {
  const d = dir.normalize("NFC"); // garde les accents si présents
  const k = d.toLowerCase();
  if (["air"].includes(k)) return "Air";
  if (["eau"].includes(k)) return "Eau";
  if (["feu"].includes(k)) return "Feu";
  if (["végétal", "vegetal"].includes(k)) return "Végétal";
  if (["minéral", "mineral"].includes(k)) return "Minéral";
  if (["arcane"].includes(k)) return "Arcane";
  return null; // inconnu → accepté quand même (utile si d’autres dossiers existent)
}

// Fabrique un “joli nom” depuis le nom de fichier
function prettyNameFromFilename(basename) {
  // enlève l’extension
  const noExt = basename.replace(/\.[^.]+$/,"");

  // essaye de retirer des préfixes type "imgi_123_", "img_12_", etc.
  let s = noExt.replace(/^(imgi?|card|img)?_?\d+_?/i, "");

  // remplace séparateurs classiques par espaces
  s = s
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Remet une majuscule au début de chaque mot
  s = s.split(" ").map(w => w ? (w[0].toUpperCase() + w.slice(1)) : w).join(" ");

  // Petites corrections fréquentes
  s = s
    .replace(/\bL (\w)/g, "L’$1")
    .replace(/\bD (\w)/g, "D’$1")
    .replace(/\bDe L (\w)/g, "De L’$1")
    .replace(/\bDu\b/gi, "Du"); // etc. (optionnel)

  return s;
}

// Force les slashs Unix pour le front
function toWebPath(p) {
  return p.split(path.sep).join("/");
}

async function main() {
  // Vérifie existence du dossier cartes/
  try {
    const stat = await fs.stat(CARDS_DIR);
    if (!stat.isDirectory()) {
      console.error("❌ 'cartes' existe mais n’est pas un dossier.");
      process.exit(1);
    }
  } catch {
    console.error("❌ Dossier 'cartes' introuvable. Place ce script à la racine du projet, à côté de 'cartes/'.");
    process.exit(1);
  }

  // Lis les sous-dossiers de cartes/
  const subdirs = await fs.readdir(CARDS_DIR, { withFileTypes: true });
  const results = [];

  for (const entry of subdirs) {
    if (!entry.isDirectory()) continue;

    const dirName = entry.name;
    const el = normElement(dirName); // peut être null, on accepte quand même
    const subPath = path.join(CARDS_DIR, dirName);

    const files = await fs.readdir(subPath, { withFileTypes: true });
    for (const f of files) {
      if (!f.isFile()) continue;

      const ext = path.extname(f.name).toLowerCase();
      if (!VALID_EXT.has(ext)) continue;

      const rel = toWebPath(path.join("cartes", dirName, f.name));

      if (MODE_OBJECTS) {
        results.push({
          path: rel,
          element: el || "Inconnu",
          name: prettyNameFromFilename(f.name)
        });
      } else {
        results.push(rel);
      }
    }
  }

  // Trie par chemin pour stabilité
  results.sort((a, b) => {
    const aa = typeof a === "string" ? a : a.path;
    const bb = typeof b === "string" ? b : b.path;
    return aa.localeCompare(bb, "fr");
  });

  await fs.writeFile(OUTPUT, JSON.stringify(results, null, 2), "utf8");
  console.log(`✅ cards.json généré (${results.length} entrées) → ${OUTPUT}`);
}

main().catch(err => {
  console.error("❌ Erreur:", err);
  process.exit(1);
});
