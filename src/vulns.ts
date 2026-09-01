import { isTestFile } from './practices.ts';
import type { AddedLine } from './git.ts';
import type { Finding } from './types.ts';

interface ExploitPattern {
  re: RegExp;
  how: string;
}

const PATTERNS: ExploitPattern[] = [
  { re: /\beval\s*\(|\bnew Function\s*\(/, how: 'whatever reaches this runs as code, so user input here lets an attacker run code' },
  { re: /\bexec(?:Sync)?\s*\(\s*[^'"`)\s]|\bsystem\s*\(\s*[^'")\s]|shell\s*=\s*True/, how: 'a shell command built from a variable, so user input here means command injection' },
  { re: /\b(query|execute|prepare|raw)\s*\(\s*(`[^`]*\$\{|['"][^'"]*['"]\s*\+\s*\w|\w+\s*\+\s*['"])/i, how: 'SQL built from string pieces runs whatever ends up inside, so use a parameterized query' },
  { re: /\.(innerHTML|outerHTML)\s*=|dangerouslySetInnerHTML|document\.write\s*\(/, how: 'HTML built from data goes straight into the page, so user input here means script injection' },
  { re: /\bpickle\.loads?\s*\(|\byaml\.load\s*\((?![^)]*Loader)|\bMarshal\.load\s*\(|\bunserialize\s*\(/, how: 'deserializing untrusted data can run code hidden inside it, so use a safe loader' },
  { re: /passw(?:or)?d[^\n]{0,40}\b(md5|sha1)\b|\b(md5|sha1)\b[^\n]{0,40}passw(?:or)?d/i, how: 'md5 and sha1 fall to brute force for passwords, so use bcrypt, scrypt or argon2' },
  { re: /(token|secret|otp|nonce|session)[^\n]{0,40}Math\.random|Math\.random[^\n]{0,40}(token|secret|otp|nonce|session)/i, how: 'Math.random is predictable, so anything secret made from it can be guessed' },
  { re: /rejectUnauthorized\s*:\s*false|verify\s*=\s*False|InsecureSkipVerify\s*:\s*true/, how: 'certificate checks are off, so anyone between the machines can read or change this traffic' },
  { re: /\b(readFile|writeFile|createReadStream|sendFile|openSync|open)\s*\([^)\n]*\breq\.(query|params|body)/, how: 'a file path built from request data can climb out of the intended folder, so validate the name' },
  { re: /\bredirect\s*\(\s*[^)\n]*\breq\.(query|params|body)/, how: 'a redirect built from request data can send people to an attacker page, so allowlist the targets' },
];

const SKIP = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|.*\.min\.js|.*\.map|.*\.lock|.*\.md)$/;

export const EXPLOIT_CAP = 12;

export function scanExploitable(lines: AddedLine[], testPatterns: string[]): Finding[] {
  const out: Finding[] = [];
  for (const l of lines) {
    if (SKIP.test(l.file) || isTestFile(l.file, testPatterns)) continue;
    for (const p of PATTERNS) {
      if (!p.re.test(l.text)) continue;
      out.push({ severity: 'major', text: `${l.file}:${l.line} ${p.how}`, file: l.file, line: l.line });
      break;
    }
    if (out.length >= EXPLOIT_CAP) break;
  }
  return out;
}
