// Build and publish dist/ to the gh-pages branch (GitHub Pages). Run: npm run deploy
import { execSync } from 'node:child_process';
const sh = (c, o = {}) => execSync(c, { stdio: 'inherit', ...o });
const out = c => execSync(c).toString().trim();

sh('node tools/test.mjs');
sh('node tools/build.mjs');
const remote = out('git remote get-url origin');
const rev = out('git rev-parse --short HEAD');
const name = out('git config user.name'), email = out('git config user.email');
const opt = { cwd: 'dist' };
sh('git init -q -b gh-pages', opt);
sh(`git -c user.name="${name}" -c user.email="${email}" -c core.autocrlf=false add -A`, opt);
sh(`git -c user.name="${name}" -c user.email="${email}" commit -q -m "Deploy ${rev}"`, opt);
sh(`git push -q -f ${remote} gh-pages`, opt);
console.log('deployed — GitHub Pages updates in about a minute');
