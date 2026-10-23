/** Keep product and test artifacts separate; stale deleted sources must never survive a build. */
import { rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=dirname(fileURLToPath(import.meta.url));
const tests=process.argv.includes('--tests');
rmSync(join(root,tests?'test-dist':'dist'),{recursive:true,force:true});
const result=spawnSync(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'-p',tests?'tsconfig.test.json':'tsconfig.json'],{cwd:root,stdio:'inherit'});
process.exit(result.status??1);
