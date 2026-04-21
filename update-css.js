const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, 'src', 'style.css');
let css = fs.readFileSync(cssPath, 'utf8');

css = css.replace(/arena-page/g, 'pageant-page');
css = css.replace(/arena-header/g, 'pageant-header');
css = css.replace(/arena-prompt/g, 'pageant-prompt');
css = css.replace(/arena-matchup/g, 'pageant-matchup');
css = css.replace(/arena-fighter/g, 'pageant-contestant');
css = css.replace(/arena-actions/g, 'pageant-actions');
css = css.replace(/arena-btn/g, 'pageant-btn');
css = css.replace(/arena-stats-bar/g, 'pageant-stats-bar');
css = css.replace(/arena-stat/g, 'pageant-stat');

css = css.replace(/fighter-winner/g, 'contestant-winner');
css = css.replace(/fighter-loser/g, 'contestant-loser');
css = css.replace(/fighter-panel/g, 'contestant-panel');
css = css.replace(/fighter-image/g, 'contestant-image');
css = css.replace(/fighter-info/g, 'contestant-info');
css = css.replace(/fighter-name/g, 'contestant-name');
css = css.replace(/fighter-stats/g, 'contestant-stats');
css = css.replace(/fighter-stat/g, 'contestant-stat');
css = css.replace(/fighter-elo/g, 'contestant-elo');

css = css.replace(/vs-badge/g, 'star-badge');
css = css.replace(/vs-burst/g, 'star-burst');
css = css.replace(/vs-text/g, 'star-text');

css = css.replace(/comic-effect/g, 'glamour-effect');
css = css.replace(/comic-starburst/g, 'glamour-starburst');
css = css.replace(/comic-text/g, 'glamour-text');

fs.writeFileSync(cssPath, css);
console.log('CSS updated successfully');
