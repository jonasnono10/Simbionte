// Temporary AST-based evidence collector; never edits the product types.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');
const out = process.argv[2];
const printer = ts.createPrinter({ removeComments: true });
const key = (n) => n.name?.text ?? n.name?.getText() ?? '';
const ordered = (xs) => xs.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
function normalize(n, source) {
  if (!n) return null;
  if (ts.isParenthesizedTypeNode(n)) return normalize(n.type, source);
  if (ts.isTypeLiteralNode(n)) return { object: ordered(n.members.map(m => ({ name: key(m), optional: !!m.questionToken, type: normalize(m.type, source) }))) };
  if (ts.isUnionTypeNode(n)) return { union: ordered(n.types.map(t => normalize(t, source))) };
  if (ts.isIntersectionTypeNode(n)) return { intersection: ordered(n.types.map(t => normalize(t, source))) };
  if (ts.isTupleTypeNode(n)) {
    const items = n.elements.map(t => normalize(t, source));
    // Relationship entries are unordered; columns inside a composite FK are not.
    const relations = n.elements.length > 0 && n.elements.every(t => ts.isTypeLiteralNode(t) && t.members.some(m => key(m) === 'foreignKeyName'));
    return { tuple: relations ? ordered(items) : items };
  }
  if (ts.isArrayTypeNode(n)) return { array: normalize(n.elementType, source) };
  return printer.printNode(ts.EmitHint.Unspecified, n, source).trim();
}
function member(n, name) {
  const m = n?.members?.find(x => key(x) === name);
  if (!m) throw new Error(`Missing AST member: ${name}`);
  return m.type;
}
function read(name) {
  const bytes = fs.readFileSync(path.join(out, `database.types.${name}.ts`));
  const text = bytes.toString('utf8');
  const source = ts.createSourceFile(name + '.ts', text, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length) throw new Error(`Invalid TypeScript: ${name}`);
  const db = source.statements.find(n => ts.isTypeAliasDeclaration(n) && n.name.text === 'Database')?.type;
  if (!db) throw new Error('Missing Database alias');
  const pub = member(db, 'public');
  const tables = member(pub, 'Tables');
  const tableMap = Object.fromEntries(tables.members.map(m => [key(m), normalize(m.type, source)]));
  const raw = Object.fromEntries(tables.members.map(m => [key(m), printer.printNode(ts.EmitHint.Unspecified, m, source)]));
  return { source, db, pub, tables: tableMap, raw, metrics: { lines: text.split('\n').length - Number(text.endsWith('\n')), bytes: bytes.length, tables: tables.members.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') } };
}
const current = read('current'), generated = read('probe_a'), repeat = read('probe_b');
const names = (x) => Object.keys(x.tables).sort();
const added = names(generated).filter(n => !current.tables[n]);
const removed = names(current).filter(n => !generated.tables[n]);
const common = names(current).filter(n => generated.tables[n]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const changed = common.filter(n => !same(current.tables[n], generated.tables[n]));
const details = {};
for (const table of changed) {
  const c = Object.fromEntries(current.tables[table].object.map(x => [x.name, x.type]));
  const g = Object.fromEntries(generated.tables[table].object.map(x => [x.name, x.type]));
  details[table] = {};
  for (const section of new Set([...Object.keys(c), ...Object.keys(g)])) {
    if (same(c[section], g[section])) continue;
    if (c[section]?.object && g[section]?.object) {
      const cm = Object.fromEntries(c[section].object.map(x => [x.name, x]));
      const gm = Object.fromEntries(g[section].object.map(x => [x.name, x]));
      details[table][section] = { added: Object.keys(gm).filter(n => !cm[n]), removed: Object.keys(cm).filter(n => !gm[n]), changed: Object.keys(cm).filter(n => gm[n] && !same(cm[n], gm[n])).map(n => ({ name: n, before: cm[n], after: gm[n] })) };
    } else details[table][section] = { before: c[section], after: g[section] };
  }
}
const otherPublic = {};
for (const section of ['Views', 'Functions', 'Enums', 'CompositeTypes']) {
  const c = member(current.pub, section), g = member(generated.pub, section);
  otherPublic[section] = { equivalent: same(normalize(c, current.source), normalize(g, generated.source)), currentMembers: c.members?.length ?? null, generatedMembers: g.members?.length ?? null };
}
const bpNames = ['business_profile_installations', 'business_profile_contributions', 'business_profile_operations'];
for (const n of bpNames) if (!generated.tables[n]) throw new Error(`Generated table missing: ${n}`);
const report = {
  comparisonScope: 'public schema; auth/storage are harness stubs, graphql_public is not generated',
  current: current.metrics, generated: generated.metrics, repeat: repeat.metrics,
  reproducibleBytes: current.metrics.sha256 !== generated.metrics.sha256 && generated.metrics.sha256 === repeat.metrics.sha256,
  reproducibleSemantics: same(normalize(generated.db, generated.source), normalize(repeat.db, repeat.source)),
  addedTables: added, removedTables: removed, changedTables: changed,
  unchangedTables: common.filter(n => !changed.includes(n)), tableDetails: details, otherPublic,
  currentSchemas: current.db.members.map(key), generatedSchemas: generated.db.members.map(key),
  businessProfiles: Object.fromEntries(bpNames.map(n => [n, generated.tables[n]])),
};
fs.writeFileSync(path.join(out, 'comparison.json'), JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'business-profile-generated-blocks.txt'), bpNames.map(n => generated.raw[n]).join('\n\n') + '\n');
const concise = { current: report.current, generated: report.generated, repeat: report.repeat, reproducibleBytes: report.reproducibleBytes, reproducibleSemantics: report.reproducibleSemantics, addedTables: added, removedTables: removed, changedTables: changed, unchangedTableCount: report.unchangedTables.length, otherPublic };
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(concise, null, 2) + '\n');
console.log(JSON.stringify(concise, null, 2));
if (!report.reproducibleBytes || !report.reproducibleSemantics) throw new Error('TYPE_GENERATION_NOT_REPRODUCIBLE');
