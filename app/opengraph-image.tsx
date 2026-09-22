import { ImageResponse } from "next/og";

export const alt = "CookieMarkets — crypto prediction markets on Cookie Chain";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "72px 84px", background: "#f8f8f4", color: "#171719", fontFamily: "Arial, sans-serif" }}>
      <div style={{ display: "flex", flexDirection: "column", width: 760 }}>
        <div style={{ display: "flex", marginBottom: 34, color: "#6f8d00", fontSize: 24, fontWeight: 800, letterSpacing: 3 }}>CRYPTO PREDICTION MARKET</div>
        <div style={{ display: "flex", fontSize: 74, fontWeight: 800, lineHeight: 1.02, letterSpacing: -4 }}>Predict crypto trends. Settle on-chain.</div>
        <div style={{ display: "flex", marginTop: 30, color: "#6f706c", fontSize: 28 }}>Real BTC and ETH markets powered by COOK.</div>
      </div>
      <div style={{ width: 280, height: 360, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 36, background: "linear-gradient(145deg, #111719, #1e2a13)", boxShadow: "0 24px 60px rgba(20,20,18,.22)" }}>
        <div style={{ width: 190, height: 190, display: "flex", position: "relative", borderRadius: 999, background: "#d8ff45", boxShadow: "inset 0 0 0 8px rgba(17,23,25,.08)" }}>
          {[{ x: 42, y: 42, s: 24 }, { x: 112, y: 35, s: 20 }, { x: 126, y: 105, s: 27 }, { x: 63, y: 125, s: 23 }, { x: 35, y: 91, s: 18 }, { x: 88, y: 78, s: 17 }].map((chip, index) => <div key={index} style={{ position: "absolute", left: chip.x, top: chip.y, width: chip.s, height: chip.s, borderRadius: 999, background: "#55351e" }} />)}
        </div>
      </div>
    </div>,
    size
  );
}
