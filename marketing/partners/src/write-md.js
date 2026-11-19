// Writes ../PARTNER_POSTS.md: one post per vault provider, with its graphic and copy-ready text.
const { writeFileSync } = require("fs");
const { join } = require("path");
const { PARTNERS } = require("./partners.js");
let md = `# Pecun partner posts\n\nOne post per vault provider live on Pecun: attach the graphic from \`graphics/\` and post the text.\n\n`;
md += `- Handles marked "check" weren't found on the protocol's own site: open their X profile and confirm before posting.\n`;
md += `- These say "live on Pecun", not "partnership": only call it a partnership once they've agreed to one.\n`;
md += `- Space them out: 2 or 3 a day reads as momentum, 29 in a day reads as spam.\n`;
PARTNERS.forEach((p, i) => {
  md += `\n## ${i + 1}. ${p.name} ${p.handleChecked ? "" : "(check handle)"}\n\n![${p.name}](graphics/${p.id}.png)\n\n\`\`\`text\n${p.text}\n\`\`\`\n`;
});
writeFileSync(join(__dirname, "..", "PARTNER_POSTS.md"), md);
console.log("wrote PARTNER_POSTS.md");
