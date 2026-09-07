function locationFor(source, index) {
  const before = source.slice(0, index);
  const line = before.split('\n').length;
  const lastNewline = before.lastIndexOf('\n');
  const column = index - lastNewline;
  return { line, column };
}

const PATTERNS = Object.freeze([
  {
    kind: 'member',
    pattern: /\b(?:req|request)\s*(?:\?\.|\.)\s*query\b/g
  },
  {
    kind: 'bracket',
    pattern: /\b(?:req|request)\s*(?:\?\.)?\s*\[\s*(['"])query\1\s*\]/g
  },
  {
    kind: 'destructure',
    pattern: /\{[^}\n]*\bquery\b[^}\n]*\}\s*=\s*(?:req|request)\b/g
  }
]);

export function findLegacyRequestQueryAccesses(source) {
  const text = String(source ?? '');
  const findings = [];

  for (const { kind, pattern } of PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const { line, column } = locationFor(text, match.index);
      findings.push({ kind, index: match.index, line, column });
    }
  }

  return findings.sort((left, right) => left.index - right.index || left.kind.localeCompare(right.kind));
}
