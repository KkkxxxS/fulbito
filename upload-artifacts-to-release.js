/**
 * upload-artifacts-to-release.js
 *
 * Sube pronosticos.json, pronosticos_historicos.jsonl y bitacora_recalibracion.jsonl
 * a una GitHub Release llamada "daily-artifacts" (tag: artifacts-daily).
 * Si la release existe, reemplaza los assets; si no, la crea.
 *
 * Requiere: GH_TOKEN en el entorno (con alcance repo). El workflow ya lo tiene.
 *
 * Uso: node upload-artifacts-to-release.js
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = 'kkkxxxs/fulbito';
const TAG = 'artifacts-daily';
const RELEASE_NAME = 'Daily artifacts';
const ASSETS = [
  'pronosticos.json',
  'pronosticos_historicos.jsonl',
  'bitacora_recalibracion.jsonl'
];

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '');
    console.error('✖', cmd);
    console.error(out);
    throw e;
  }
}

function existeAsset(assetName) {
  try {
    const info = run(`gh api repos/${REPO}/releases/tags/${TAG} --jq '.assets[] | select(.name=="${assetName}") | .id'`);
    return info ? info.trim() : null;
  } catch (e) {
    return null;
  }
}

function main() {
  const token = process.env.GH_TOKEN;
  if (!token) {
    console.error('✖ Falta GH_TOKEN en el entorno');
    process.exit(1);
  }
  process.env.GH_TOKEN = token;

  console.log('=== Subiendo artefactos a GitHub Release ===');
  console.log('Repo:', REPO);
  console.log('Tag:', TAG);

  // Verificar que los archivos existen
  const faltantes = ASSETS.filter(f => !fs.existsSync(f));
  if (faltantes.length) {
    console.error('✖ Archivos faltantes:', faltantes.join(', '));
    process.exit(1);
  }

  // Verificar si la release existe
  let releaseId = null;
  try {
    const info = run(`gh api repos/${REPO}/releases/tags/${TAG} --jq '.id'`);
    releaseId = info.trim();
    console.log('Release existente, id:', releaseId);
  } catch (e) {
    console.log('Release no existe, se creará...');
  }

  // Si no existe, crear release
  if (!releaseId) {
    const salida = run(`gh api --method POST repos/${REPO}/releases -f tag_name=${TAG} -f name="${RELEASE_NAME}" -f draft=false -f prerelease=false -f generate_release_notes=false`);
    const parsed = JSON.parse(salida);
    releaseId = parsed.id;
    console.log('Release creada, id:', releaseId);
  }

  // Subir/reemplazar cada asset
  for (const asset of ASSETS) {
    const idExistente = existeAsset(asset);
    if (idExistente) {
      console.log(`  → Eliminando asset previo: ${asset} (id=${idExistente})`);
      run(`gh api --method DELETE repos/${REPO}/releases/assets/${idExistente}`);
    }
    console.log(`  → Subiendo ${asset} (${(fs.statSync(asset).size / 1024).toFixed(1)} KB)...`);
    run(`gh release upload ${TAG} ${asset} --clobber`);
    console.log(`  ✓ ${asset} subido`);
  }

  console.log('\n=== ARTEFACTOS SUBIDOS A RELEASE ===');
  console.log('URL:', `https://github.com/${REPO}/releases/tag/${TAG}`);
}

main();