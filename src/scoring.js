export function evaluateAudit(audit) {
  const checks = [];
  const add = (id, section, title, pass, points, detail, advice) => checks.push({id,section,title,status:pass ? 'pass' : 'review',points,detail,advice});
  const titleLength = audit.title.length;
  add('title','Metadata','Descriptive page title',titleLength >= 15 && titleLength <= 65,12,`${titleLength} characters`,'Use a concise, descriptive title. The range is a review guideline, not a Google limit.');
  add('description','Metadata','Meta description',audit.description.length >= 50 && audit.description.length <= 170,8,`${audit.description.length} characters`,'Write a useful summary. Search engines may generate a different snippet.');
  const h1 = audit.headings.filter(h => h.level === 1).length;
  add('h1','Content','Clear primary heading',h1 === 1,10,`${h1} H1 headings`,'Review the page hierarchy and make its primary topic clear. Multiple H1s are not automatically a ranking penalty.');
  add('outline','Content','Heading sequence',audit.headingSkips === 0,6,`${audit.headingSkips} skipped heading levels`,'Use a logical outline for readers and assistive technology.');
  const missingAlt = audit.images.filter(img => img.alt === null).length;
  add('alt','Images','Image alt attributes',missingAlt === 0,10,`${missingAlt} missing alt attributes`,'Describe meaningful images. Empty alt text is appropriate for decorative images.');
  add('canonical','Technical','Canonical declaration',!!audit.canonical,8,audit.canonical || 'Not declared','Review whether this page needs a canonical URL; absence is not always an error.');
  add('viewport','Technical','Mobile viewport',!!audit.viewport,8,audit.viewport || 'Not declared','Use an appropriate viewport declaration for responsive layouts.');
  add('language','Technical','Document language',!!audit.language,6,audit.language || 'Not declared','Set the primary document language on the HTML element.');
  add('https','Security','HTTPS connection',audit.https,10,audit.https ? 'Encrypted page URL' : 'HTTP page URL','Serve public production pages over HTTPS.');
  add('mixed','Security','No mixed asset URLs',audit.technical.mixedContent === 0,6,`${audit.technical.mixedContent} HTTP asset URLs`,'Replace insecure asset URLs on HTTPS pages. This check is DOM-based, not a full network trace.');
  const invalid = audit.schemas.filter(s => !s.valid).length;
  add('jsonld','Structured data','JSON-LD syntax',invalid === 0,6,`${invalid} invalid JSON-LD blocks`,'Fix invalid JSON. Syntax validity does not establish rich-result eligibility.');
  const og = audit.social.some(item => item.name.toLowerCase() === 'og:title');
  add('social','Sharing','Social title metadata',og,5,og ? 'og:title declared' : 'og:title absent','Add sharing metadata where social previews matter.');
  const emptyLinks = audit.links.filter(link => /^https?:$/.test(link.protocol) && !link.text).length;
  add('linktext','Links','Descriptive link labels',emptyLinks === 0,5,`${emptyLinks} links without extracted labels`,'Give links accessible and descriptive names; confirm labels in an accessibility audit.');
  const earned = checks.reduce((sum,c) => sum + (c.status === 'pass' ? c.points : 0),0);
  const possible = checks.reduce((sum,c) => sum + c.points,0);
  const score = Math.round(earned / possible * 100);
  const readinessChecks = [
    {name:'Readable content',pass:audit.content.words >= 150},
    {name:'Structured outline',pass:audit.headings.some(h => h.level === 2)},
    {name:'Parseable structured data',pass:audit.schemas.some(s => s.valid && s.types.length)},
    {name:'Indexing allowed by page meta',pass:!/(?:^|[\s,])(?:noindex|none)(?:$|[\s,])/i.test(audit.robots)},
    {name:'Document language',pass:!!audit.language}
  ];
  return {score,checks,readinessChecks,readiness:Math.round(readinessChecks.filter(c => c.pass).length / readinessChecks.length * 100)};
}

export function csv(rows) {
  const quote = value => {
    let text = String(value ?? '');
    if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"','""') + '"';
  };
  return rows.map(row => row.map(quote).join(',')).join('\r\n');
}
