// Writes ../POSTS.md: the week's posts in order, each with its graphic and copy-ready text.
const { writeFileSync } = require("fs");
const { join } = require("path");
const { POSTS, RATES_DATE } = require("./posts.js");

let md = `# Pecun on X: week 1\n\n3 posts a day for 7 days. Each post's graphic is in \`graphics/\`; attach it to the first tweet.\n\n`;
md += `- Post times that work for crypto audiences: about 9:00, 13:00 and 18:00 New York time.\n`;
md += `- Multi-part posts are threads: post the first, then reply to it with the next.\n`;
md += `- Rates were read from the app on ${RATES_DATE}. Check them in the app on the day and update the post if they've moved.\n`;
md += `- Partner posts say "live on Pecun" and tag the protocol. Only call it a partnership once they've agreed to one.\n`;
for (let day = 1; day <= 7; day++) {
  md += `\n## Day ${day}\n`;
  for (const p of POSTS.filter((x) => x.day === day)) {
    md += `\n### ${p.slot}\n\n![${p.id}](graphics/${p.id}.png)\n\n`;
    p.text.forEach((t, i) => {
      if (p.text.length > 1) md += `**${i + 1}/${p.text.length}**\n\n`;
      md += "```text\n" + t + "\n```\n\n";
    });
  }
}
writeFileSync(join(__dirname, "..", "POSTS.md"), md);
console.log("wrote POSTS.md");
