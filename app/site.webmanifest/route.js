function manifest() {
  return {
    name: "Pattern Projector",
    short_name: "PatternProjector",
    start_url: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/calibrate`,
    icons: [
      {
        src: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/144.png`,
        sizes: "144x144",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/512.png`,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    display: "fullscreen",
    background_color: "#fff",
    description:
      "Calibrates projectors for projecting sewing patterns with accurate scaling and without perspective distortion",
    theme_color: "#fff",
    file_handlers: [
      {
        action: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/calibrate`,
        accept: {
          "application/pdf": [".pdf"],
        },
      },
    ],
  };
}

// Served as a route (not app/manifest.js) so the <link rel="manifest"> and
// the manifest's own URLs respect NEXT_PUBLIC_BASE_PATH.
export function GET() {
  return Response.json(manifest(), {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
