import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

export function database(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec('PRAGMA foreign_keys=ON');
  const directory = new URL('../drizzle/', import.meta.url);
  for (const file of readdirSync(directory).filter(f => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(file, directory), 'utf8'));
  const db = {
    prepare(sql) { return { bind(...args) {
      const statement = sqlite.prepare(sql);
      return {
        async first() { return statement.get(...args) ?? null; },
        async all() { return { results: statement.all(...args) }; },
        execute() { return { meta: { changes: Number(statement.run(...args).changes) } }; },
        async run() { return this.execute(); },
      };
    } }; },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const results = statements.map(s => s.execute()); sqlite.exec('COMMIT'); return results; }
      catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    },
  };
  for (const [id, name] of [['alice', '小周'], ['bob', '小陈'], ['cathy', '小林']]) sqlite.prepare('INSERT INTO profiles (user,name) VALUES (?,?)').run(id, name);
  return { db, sqlite };
}
