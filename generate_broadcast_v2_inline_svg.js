const fs = require("fs");
const path = require("path");

const root = __dirname;
const assetsDir = path.join(root, "assets", "broadcastV2-figma");
const htmlPath = path.join(root, "broadcastV2.html");
const REEL_ROW_HEIGHT = 118;
const REEL_CENTER_Y = 176;
const REEL_BASE_INDEX = 20;

function readSvg(fileName, prefix) {
    const filePath = path.join(assetsDir, fileName);
    const svg = fs.readFileSync(filePath, "utf8");
    const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);

    if (!viewBoxMatch) {
        throw new Error(`Missing viewBox in ${fileName}`);
    }

    let inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
    const ids = [...inner.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);

    ids.forEach((id) => {
        const safeId = `${prefix}__${id}`;
        inner = inner.replace(new RegExp(`id="${escapeRegExp(id)}"`, "g"), `id="${safeId}"`);
        inner = inner.replace(new RegExp(`url\\(#${escapeRegExp(id)}\\)`, "g"), `url(#${safeId})`);
        inner = inner.replace(new RegExp(`href="#${escapeRegExp(id)}"`, "g"), `href="#${safeId}"`);
        inner = inner.replace(new RegExp(`xlink:href="#${escapeRegExp(id)}"`, "g"), `xlink:href="#${safeId}"`);
    });

    return {
        viewBox: viewBoxMatch[1],
        inner
    };
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function inlineSvg({ fileName, prefix, x, y, width, height, className = "", style = "" }) {
    const { viewBox, inner } = readSvg(fileName, prefix);
    const attrs = [
        `x="${x}"`,
        `y="${y}"`,
        `width="${width}"`,
        `height="${height}"`,
        `viewBox="${viewBox}"`,
        `preserveAspectRatio="none"`,
        `overflow="visible"`
    ];

    if (className) {
        attrs.push(`class="${className}"`);
    }

    if (style) {
        attrs.push(`style="${style}"`);
    }

    return `<svg ${attrs.join(" ")}>${inner}</svg>`;
}

function reelGroup(index, x) {
    const clipId = `reel-clip-${index}`;

    return `
      <g transform="translate(${x} 402)">
        <defs>
          <clipPath id="${clipId}">
            <rect x="0" y="0" width="217" height="353"></rect>
          </clipPath>
        </defs>
        <g clip-path="url(#${clipId})" mask="url(#reel-fade-mask)">
          <g id="reel-strip-${index}" transform="translate(0 ${REEL_CENTER_Y - (REEL_BASE_INDEX * REEL_ROW_HEIGHT)})">
          </g>
        </g>
      </g>`;
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Broadcast V2</title>
    <link rel="stylesheet" href="broadcastV2.css">
</head>
<body class="broadcast-v2-page">
    <div id="audio-control" class="broadcast-v2-audio-control is-hidden">
        <button type="button" id="audio-unlock-button" class="broadcast-v2-audio-button">Enable Sound</button>
        <div id="audio-status" class="broadcast-v2-audio-status">Audio locked by browser</div>
    </div>
    <main class="broadcast-v2-root">
        <svg class="broadcast-v2-svg" viewBox="0 0 1920 1080" aria-label="Gachapon Simulator V2" role="img">
            <defs>
                <linearGradient id="reel-fade-gradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="black"></stop>
                    <stop offset="18%" stop-color="white"></stop>
                    <stop offset="82%" stop-color="white"></stop>
                    <stop offset="100%" stop-color="black"></stop>
                </linearGradient>
                <mask id="reel-fade-mask" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse">
                    <rect x="0" y="0" width="217" height="353" fill="url(#reel-fade-gradient)"></rect>
                </mask>
            </defs>
            <image href="assets/broadcastV2-figma/bg.jpg" x="-194" y="-27" width="2184" height="1227" preserveAspectRatio="none"></image>

            <g transform="translate(0 -27)">
                <path d="M0 0H56V1133H0Z" fill="#5901EF"></path>
                ${inlineSvg({
                    fileName: "dots-left.svg",
                    prefix: "dots-left",
                    x: 16,
                    y: -65.5,
                    width: 24,
                    height: 1264
                })}
            </g>

            <g transform="translate(1864 -27)">
                <path d="M0 0H56V1133H0Z" fill="#5901EF"></path>
                ${inlineSvg({
                    fileName: "dots-right.svg",
                    prefix: "dots-right",
                    x: 16,
                    y: 14.5,
                    width: 24,
                    height: 1104
                })}
            </g>

            ${inlineSvg({
                fileName: "glow.svg",
                prefix: "glow",
                x: 400.162109375,
                y: 333,
                width: 1112.322265625,
                height: 491,
                className: "broadcast-v2-glow"
            })}

            ${inlineSvg({
                fileName: "shell-back.svg",
                prefix: "shell-back",
                x: 424.0548551082611,
                y: 364.6956024169922,
                width: 1064.4468994140625,
                height: 428.114501953125
            })}
            ${inlineSvg({
                fileName: "body-outer.svg",
                prefix: "body-outer",
                x: 491.85671973228455,
                y: 333.24072265625,
                width: 928.93408203125,
                height: 491.0248107910156
            })}
            ${inlineSvg({
                fileName: "body-inner.svg",
                prefix: "body-inner",
                x: 497.8964898586273,
                y: 333.2412034975132,
                width: 916.7623901367188,
                height: 491.0248107910156
            })}
            ${inlineSvg({
                fileName: "window-back.svg",
                prefix: "window-back",
                x: 541.3976762294769,
                y: 392.54550655186176,
                width: 829.7564086914062,
                height: 372.504638671875
            })}
            ${inlineSvg({
                fileName: "window-face.svg",
                prefix: "window-face",
                x: 551.1353499889374,
                y: 402.0992212295532,
                width: 810.281494140625,
                height: 353.3070983886719
            })}
            ${inlineSvg({
                fileName: "window-core.svg",
                prefix: "window-core",
                x: 551.1360623836517,
                y: 402.0990324020386,
                width: 810.281494140625,
                height: 353.3070983886719,
                style: "mix-blend-mode:multiply"
            })}
            ${inlineSvg({
                fileName: "bottom-shadow-1.svg",
                prefix: "bottom-shadow-1",
                x: 320.99949572913465,
                y: 813.3593594044505,
                width: 1270.3758544921875,
                height: 125.64036560058594,
                style: "mix-blend-mode:multiply"
            })}
            ${inlineSvg({
                fileName: "bottom-shadow-2.svg",
                prefix: "bottom-shadow-2",
                x: 324.7858071249357,
                y: 864.2825202941895,
                width: 1270.375732421875,
                height: 62.91032791137695,
                style: "mix-blend-mode:multiply"
            })}

            <g id="ticket-digits">
                ${reelGroup(1, 562)}
                ${reelGroup(2, 847)}
                ${reelGroup(3, 1132)}
            </g>

            ${inlineSvg({
                fileName: "handle-group.svg",
                prefix: "handle-group",
                x: 1431.2441098690033,
                y: 214.03558349609375,
                width: 109.32817840576172,
                height: 240.39242553710938
            })}
            <image href="assets/broadcastV2-figma/handle-sphere.png" x="1484" y="141" width="114" height="113" preserveAspectRatio="none"></image>

            <text class="broadcast-v2-title" x="116" y="134" dominant-baseline="middle">GiVEAWAY</text>
            ${inlineSvg({
                fileName: "logo.svg",
                prefix: "logo",
                x: 1683,
                y: 60,
                width: 121,
                height: 147.17605590820312
            })}
            <text class="broadcast-v2-caption" x="960" y="972" text-anchor="middle" dominant-baseline="middle">Winning Ticket</text>
        </svg>
    </main>

    <script src="node_modules/tone/build/Tone.js"></script>
    <script src="broadcastV2.js"></script>

    <!--
    Figma summary
    - File: 6kAX1UlEoY84vj0R6epZdz
    - Frame: 2133:1138 (Gachapon Simulator V2), 1920x1080
    - Nodes processed: 2133:1139, 2133:1385, 2133:1415, 2132:11863, 2132:1375, 2132:1412, 2132:10798, 2132:11825, 2132:11826, 2132:11820
    - Generated SVG elements: left rail dots, right rail dots, glow, shell-back, body-outer, body-inner, window-back, window-face, window-core, handle-group, logo
    - Fallback rendering: bg.jpg and handle-sphere.png were exported by Figma as raster images and are used as <image> nodes inside the SVG
    - Assets exported: assets/broadcastV2-figma/bg.jpg, assets/broadcastV2-figma/handle-sphere.png
    -->
</body>
</html>
`;

fs.writeFileSync(htmlPath, html);
