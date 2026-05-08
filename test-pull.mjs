// End-to-end test harness for the Insee pull pipeline.
// Runs in Node — same web APIs (fetch, DecompressionStream, etc.) as the browser.
// Usage: node test-pull.mjs

import { pullAll, A10_SECTORS } from './js/insee-api.js';

const t0 = Date.now();

let lastLog = 0;
function onProgress({ ratio, label }) {
  const now = Date.now();
  if (now - lastLog < 500 && ratio < 1) return; // throttle
  lastLog = now;
  const pct = (ratio * 100).toFixed(1).padStart(5, ' ');
  const elapsed = ((now - t0) / 1000).toFixed(1) + 's';
  process.stdout.write(`\r[${pct}%] ${elapsed.padStart(7)} — ${label.slice(0, 80).padEnd(80)}`);
}

try {
  const { records, warnings } = await pullAll(onProgress);
  process.stdout.write('\n\n');

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`✓ Pull terminé en ${elapsed}s`);
  console.log(`  ${records.length.toLocaleString('fr-FR')} communes (avec population ≥ 50)`);
  if (warnings.length) {
    console.log(`  ${warnings.length} avertissement(s):`);
    warnings.forEach(w => console.log('    - ' + w));
  }

  // ---- validation checks ----
  let failed = 0;
  function check(name, ok, info) {
    if (ok) {
      console.log(`  ✓ ${name}` + (info ? ` (${info})` : ''));
    } else {
      console.log(`  ✗ ${name}` + (info ? ` (${info})` : ''));
      failed++;
    }
  }

  console.log('\nValidation :');

  check('count plausible', records.length >= 28000 && records.length <= 36000,
        `${records.length} communes`);

  const byCode = new Map(records.map(r => [r.code, r]));

  const romans = byCode.get('26281');
  check('Romans-sur-Isère (26281) présente', !!romans);
  if (romans) {
    console.log(`     pop=${romans.population}, stock=${romans.stock}, density=${romans.density?.toFixed(1)}, growth10y=${(romans.growth10y * 100)?.toFixed(1)}%, créations=${romans.creations}, coverage=${(romans.sectorialCoverage * 100).toFixed(1)}%`);
    console.log(`     parts sectorielles: ${romans.sectorShares.map((s, i) => A10_SECTORS[i] + '=' + (s * 100).toFixed(1) + '%').join(' ')}`);
    check('  Romans-sur-Isère pop > 20 000', romans.population > 20000, `pop=${romans.population}`);
    check('  Romans-sur-Isère stock > 1 000', romans.stock > 1000, `stock=${romans.stock}`);
    check('  Romans-sur-Isère secteur shares somme ≈ 1',
      Math.abs(romans.sectorShares.reduce((a, b) => a + b, 0) - 1) < 0.01);
    check('  Romans-sur-Isère sectorialCoverage > 0.9', romans.sectorialCoverage > 0.9,
          `coverage=${(romans.sectorialCoverage * 100).toFixed(1)}%`);
  }

  // Sectorial coverage distribution sanity check
  const lowCov = records.filter(r => r.sectorialCoverage < 0.85).length;
  console.log(`     ${lowCov.toLocaleString('fr-FR')}/${records.length.toLocaleString('fr-FR')} communes avec coverage A10 < 85% (secret stat sur petites cellules)`);

  // Test summarizeComparables shape and the matching guards.
  const { findComparables, summarizeComparables, countInRadius } = await import('./js/matching.js');
  if (romans) {
    const result = findComparables(romans, records, { scope: { kind: 'national' } });
    check('  matching.reason = ok (national)', result.reason === 'ok', `reason=${result.reason}`);
    check('  ≥ 5 comparables trouvés', result.candidates.length >= 5, `${result.candidates.length} trouvés`);
    if (result.candidates.length) {
      const summary = summarizeComparables(romans, result.candidates);
      check('  summary.density.median fini',
        Number.isFinite(summary.summary.density.median),
        `med=${summary.summary.density.median?.toFixed(1)}`);
      check('  Q1 ≤ médiane ≤ Q3',
        summary.summary.density.q1 <= summary.summary.density.median &&
        summary.summary.density.median <= summary.summary.density.q3);
      check('  delta.density fini', Number.isFinite(summary.delta.density));
      console.log(`     densité Romans=${romans.density.toFixed(1)} | comparables Q1/med/Q3 = ${summary.summary.density.q1?.toFixed(1)} / ${summary.summary.density.median?.toFixed(1)} / ${summary.summary.density.q3?.toFixed(1)}`);
      console.log(`     écart densité vs médiane : ${(summary.delta.density * 100).toFixed(1)} %`);
      // Toutes les comparables doivent satisfaire les filtres durs
      const popMin = romans.population / 1.25;
      const popMax = romans.population * 1.25;
      const allInBand = result.candidates.every(({ commune: c }) =>
        c.population >= popMin && c.population <= popMax && c.sectorialCoverage >= 0.95);
      check('  toutes comparables dans bande pop ratio + coverage ≥ 95 %', allInBand);
    }

    // Guard rail : commune < 2 000 hab → reason = pop_floor
    const small = records.find(r => r.population > 100 && r.population < 1000);
    if (small) {
      const r = findComparables(small, records, { scope: { kind: 'national' } });
      check(`  plancher 2 000 hab actif (${small.name} ${small.population} hab → reason=${r.reason})`,
        r.reason === 'pop_floor');
    }

    // Nouveau : scope régional
    if (romans.codeRegion) {
      const rRegion = findComparables(romans, records, { scope: { kind: 'region', value: romans.codeRegion } });
      check(`  scope région (${romans.codeRegion}) — ok`, rRegion.reason === 'ok',
            `reason=${rRegion.reason}, n=${rRegion.candidates.length}`);
      const allInRegion = rRegion.candidates.every(({ commune: c }) => c.codeRegion === romans.codeRegion);
      check('  toutes comparables dans la région cible', allInRegion);
      console.log(`     scope région : ${rRegion.candidates.length} comparables Auvergne-Rhône-Alpes`);
    }

    // Nouveau : scope département + override (autre département que la cible)
    const rOtherDept = findComparables(romans, records, { scope: { kind: 'departement', value: '69' } });
    if (rOtherDept.reason === 'ok') {
      const allInDept69 = rOtherDept.candidates.every(({ commune: c }) => c.dept === '69');
      check('  override département (69 Rhône) — toutes dans le 69', allInDept69);
    }

    // Nouveau : scope distance via {kind, value}
    const rDist = findComparables(romans, records, { scope: { kind: 'distance', value: 100 } });
    if (rDist.reason === 'ok') {
      check('  scope distance 100 km — ok', true, `${rDist.candidates.length} comparables`);
    }

    // countInRadius — Romans-sur-Isère 33k hab a peu de comparables (pop ±25 %
    // = bande [27k ; 42k] + coverage ≥ 95 %) à courte distance ; on teste à 200 km
    // qui inclut Lyon hors bande mais des mid-sized en région.
    const n50  = countInRadius(romans, records, 50);
    const n200 = countInRadius(romans, records, 200);
    console.log(`     countInRadius : 50km → ${n50} commune(s), 200km → ${n200} commune(s)`);
    check('  countInRadius monotone (200km ≥ 50km)', n200 >= n50);
  }

  // sectorialCoverage distribution at 95 % threshold
  const lowCov95 = records.filter(r => r.sectorialCoverage < 0.95).length;
  console.log(`     ${lowCov95.toLocaleString('fr-FR')}/${records.length.toLocaleString('fr-FR')} communes exclues du matching pour coverage < 95 %`);

  const paris1 = byCode.get('75101');
  const paris20 = byCode.get('75120');
  check('Paris 1er (75101) présent', !!paris1, paris1 ? `pop=${paris1.population}` : '');
  check('Paris 20e (75120) présent', !!paris20, paris20 ? `pop=${paris20.population}` : '');

  const lyon1 = byCode.get('69381');
  check('Lyon 1er (69381) présent', !!lyon1, lyon1 ? `pop=${lyon1.population}` : '');

  const marseille1 = byCode.get('13201');
  check('Marseille 1er (13201) présent', !!marseille1, marseille1 ? `pop=${marseille1.population}` : '');

  // Department coverage
  const depts = new Set(records.map(r => r.dept));
  check('couverture départements', depts.size >= 96, `${depts.size} départements distincts`);

  // Indicators integrity
  const withGrowth = records.filter(r => r.growth10y != null).length;
  // stockBaseline ≥ 20 obligatoire — moitié des communes (toutes petites) sont
  // exclues du calcul, anti-bruit. C'est volontaire (recommandation statisticien).
  check('croissance 10y calculée (stockBaseline ≥ 20)', withGrowth > records.length * 0.4,
        `${withGrowth}/${records.length} communes`);

  const withCrea = records.filter(r => r.creations > 0).length;
  check('créations renseignées', withCrea > records.length * 0.5,
        `${withCrea}/${records.length} communes`);

  const withCoords = records.filter(r => r.lat != null && r.lon != null).length;
  check('coordonnées géographiques', withCoords > records.length * 0.95,
        `${withCoords}/${records.length} communes`);

  // Memory footprint estimation (serialized JSON)
  const json = JSON.stringify(records);
  const mb = (json.length / 1024 / 1024).toFixed(2);
  console.log(`\n  Empreinte sérialisée : ${mb} MB (cible spec : 5–8 MB IndexedDB)`);

  console.log(failed === 0 ? '\nTOUS LES TESTS PASSENT' : `\n${failed} test(s) en échec`);
  process.exit(failed === 0 ? 0 : 1);

} catch (err) {
  process.stdout.write('\n\n');
  console.error('✗ Pull a échoué :', err.message);
  console.error(err.stack);
  process.exit(2);
}
