/**
 * Incremental lexer for the top-level JSON analysis string. It never emits
 * keys, other values, nested analysis fields, or text outside the JSON object.
 * Malformed output falls back to the adapter's final result parser.
 */
export class ReflectionTextStream {
  private depth = 0;
  private started = false;
  private finished = false;
  private invalid = false;
  private phase: "key" | "colon" | "value" | "comma" = "key";
  private key = "";
  private inString = false;
  private keyString = false;
  private answerString = false;
  private escape = false;
  private unicode: string | undefined;
  private highSurrogate = "";
  private count = 0;

  feed(chunk: string): string {
    let output = "";
    for (const character of chunk) {
      if (this.invalid || this.finished || ++this.count > 1_000_000) break;
      if (!this.started) {
        if (character === "{") { this.started = true; this.depth = 1; }
        continue;
      }
      if (this.inString) {
        let decoded: string | undefined;
        if (this.unicode !== undefined) {
          if (!/^[a-fA-F0-9]$/.test(character)) { this.invalid = true; continue; }
          this.unicode += character;
          if (this.unicode.length === 4) { decoded = String.fromCharCode(parseInt(this.unicode, 16)); this.unicode = undefined; }
        } else if (this.escape) {
          this.escape = false;
          if (character === "u") this.unicode = "";
          else {
            const escapes: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
            decoded = escapes[character];
            if (decoded === undefined) this.invalid = true;
          }
        } else if (character === "\\") this.escape = true;
        else if (character === '"') {
          this.inString = false;
          if (this.keyString) this.phase = "colon";
          else if (this.depth === 1) this.phase = "comma";
          if (this.answerString && this.highSurrogate) { output += this.highSurrogate; this.highSurrogate = ""; }
          this.answerString = false;
        } else if (character.charCodeAt(0) < 32) this.invalid = true;
        else decoded = character;
        if (decoded !== undefined) {
          if (this.keyString && this.key.length < 100) this.key += decoded;
          if (this.answerString) {
            // Do not send a split escaped/raw surrogate pair to the renderer.
            if (decoded.length === 1 && decoded.charCodeAt(0) >= 0xd800 && decoded.charCodeAt(0) <= 0xdbff) {
              output += this.highSurrogate; this.highSurrogate = decoded;
            } else { output += this.highSurrogate + decoded; this.highSurrogate = ""; }
          }
        }
        continue;
      }
      if (character === '"') {
        this.inString = true;
        this.keyString = this.depth === 1 && this.phase === "key";
        this.answerString = this.depth === 1 && this.phase === "value" && this.key === "analysis";
        if (this.keyString) this.key = "";
      } else if (character === "{" || character === "[") this.depth++;
      else if (character === "}" || character === "]") {
        this.depth--;
        if (!this.depth) this.finished = true;
        else if (this.depth === 1) this.phase = "comma";
      } else if (this.depth === 1 && character === ":" && this.phase === "colon") this.phase = "value";
      else if (this.depth === 1 && character === ",") this.phase = "key";
    }
    return output;
  }
}
