const fs = require('fs');

let svgContent = fs.readFileSync('Gacha.svg', 'utf8');

// remove XML declaration
svgContent = svgContent.replace(/<\?xml.*\?>(\r?\n)?/, '');

// Add the knob-group id
svgContent = svgContent.replace(
    '<circle class="cls-22" cx="366.3" cy="771.55" r="60.06"',
    '<g id="knob-group" style="transform-origin: 366.3px 778.58px; cursor: pointer;"><circle class="cls-22" cx="366.3" cy="771.55" r="60.06"'
);
svgContent = svgContent.replace(
    '<circle class="cls-7" cx="366.3" cy="778.58" r="13.94" transform="translate(-443.25 487.05) rotate(-45)"/>\r\n      </g>',
    '<circle class="cls-7" cx="366.3" cy="778.58" r="13.94" transform="translate(-443.25 487.05) rotate(-45)"/>\n      </g></g>'
);

// Add balls-container
const targetString = '<circle class="cls-4" cx="366.3" cy="375.63" r="327.95"/>';
svgContent = svgContent.replace(
    targetString,
    '<g id="balls-container"></g>\n        ' + targetString
);

// We need to add defs if we want to use the ball-highlight gradient
const extraDefs = `
    <!-- Universal sphere highlighter for balls -->
    <radialGradient id="ball-highlight" cx="30%" cy="30%" r="70%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.9)" />
        <stop offset="30%" stop-color="rgba(255,255,255,0.4)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0.4)" />
    </radialGradient>
`;
svgContent = svgContent.replace('</clipPath>\r\n  </defs>', '</clipPath>\n' + extraDefs + '\n  </defs>');
svgContent = svgContent.replace('</clipPath>\n  </defs>', '</clipPath>\n' + extraDefs + '\n  </defs>');

// Add the original SVG into HTML
let htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Interactive Gacha Machine</title>
    <link rel="stylesheet" href="style.css">
    <style>
        /* additional styles specifically for the gacha */
        svg {
            width: 100%;
            height: 100%;
            max-height: 90vh;
        }
    </style>
</head>
<body>
    <div id="app">
        ${svgContent}
    </div>
    <script src="script.js"></script>
</body>
</html>`;

fs.writeFileSync('index.html', htmlContent);
console.log('HTML created successfully.');
