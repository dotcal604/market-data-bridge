import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DB_FILE = path.join(ROOT, 'src/db/database.ts');
const SCHEMA_FILE = path.join(ROOT, 'src/db/schema.ts');
const OUTPUT_FILE = path.join(ROOT, 'analytics/schema.py');

// Map SQLite types to Python types
const TYPE_MAP = {
  TEXT: 'str',
  INTEGER: 'int',
  REAL: 'float',
  BLOB: 'bytes',
  VARCHAR: 'str',
  CHAR: 'str',
  // SQLite uses 0/1, but Python/Pandas might treat as int unless cast
  BOOLEAN: 'bool',
  DATETIME: 'str',
  TIMESTAMP: 'str',
};

// Target tables for Pydantic models
const TARGET_TABLES = [
  'evaluations',
  'model_outputs',
  'outcomes',
  'orders',
  'executions',
  'weight_history',
];

function extractTableSchemas(content) {
  const tableMatches = [];
  // Regex to match CREATE TABLE statements
  // Matches: CREATE TABLE [IF NOT EXISTS] table_name ( ... );
  const regex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([^;]+)\);/gsi;

  let match;
  while ((match = regex.exec(content)) !== null) {
    const tableName = match[1];
    if (TARGET_TABLES.includes(tableName)) {
      tableMatches.push({
        tableName,
        body: match[2],
      });
    }
  }
  return tableMatches;
}

function parseColumns(body) {
  const columns = [];
  // Split by comma, but be careful about nested parentheses (though typically not needed for basic types)
  // For simplicity, we assume one column per line or comma-separated
  // We'll split by newline first to handle comments better, then by comma?
  // No, splitting by comma is safer for multi-line definitions, but we need to ignore comments.

  // First, remove comments
  const cleanBody = body.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

  // Split by comma, respecting parentheses
  const parts = [];
  let current = '';
  let parenDepth = 0;

  for (const char of cleanBody) {
    if (char === '(') parenDepth++;
    if (char === ')') parenDepth--;
    if (char === ',' && parenDepth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());

  for (const part of parts) {
    // Check if it's a column definition or a constraint (PRIMARY KEY, UNIQUE, FOREIGN KEY)
    // Basic heuristic: starts with a word that is not a constraint keyword
    const words = part.split(/\s+/).filter(w => w.length > 0);
    if (words.length < 2) continue;

    const firstWord = words[0].toUpperCase();
    if (['PRIMARY', 'UNIQUE', 'FOREIGN', 'CHECK', 'CONSTRAINT'].includes(firstWord)) {
      continue;
    }

    const name = words[0];
    // Remove (size) from type if present (e.g. VARCHAR(255))
    const type = words[1].toUpperCase().split('(')[0];

    // Check for nullability
    const isNotNull = part.toUpperCase().includes('NOT NULL');
    const isPrimaryKey = part.toUpperCase().includes('PRIMARY KEY');

    // Special case for INTEGER PRIMARY KEY which is rowid alias (not null)
    // But in general, PK implies Not Null in standard SQL, though SQLite allows NULL in PK unless strictly defined?
    // Actually standard SQLite: "PRIMARY KEY columns must not contain NULL values".

    let pythonType = TYPE_MAP[type] || 'Any';
    let isOptional = !isNotNull && !isPrimaryKey;

    columns.push({
      name,
      pythonType,
      isOptional,
    });
  }

  return columns;
}

function generatePydanticModel(tableName, columns) {
  const className = tableName
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');

  // Override for specific names if needed (e.g. ModelOutput vs ModelOutputs)
  // But standard convention is Singular for model name usually.
  // The requirement says: Evaluation, ModelOutput, Outcome, Order, Execution, WeightHistory.
  // My logic gives: Evaluations, ModelOutputs, Outcomes, Orders, Executions, WeightHistory.
  // I'll manually map them or handle pluralization.

  const classMap = {
    'evaluations': 'Evaluation',
    'model_outputs': 'ModelOutput',
    'outcomes': 'Outcome',
    'orders': 'Order',
    'executions': 'Execution',
    'weight_history': 'WeightHistory',
  };

  const modelName = classMap[tableName] || className;

  let code = `class ${modelName}(BaseModel):\n`;
  if (columns.length === 0) {
    code += `    pass\n`;
    return code;
  }

  for (const col of columns) {
    let typeHint = col.pythonType;
    if (col.isOptional) {
      typeHint = `Optional[${typeHint}]`;
    }
    code += `    ${col.name}: ${typeHint}\n`;
  }
  return code;
}

function main() {
  console.log('Generating Python schema...');

  // Read files
  let content = '';
  if (fs.existsSync(DB_FILE)) {
    content += fs.readFileSync(DB_FILE, 'utf-8');
  }
  if (fs.existsSync(SCHEMA_FILE)) {
    content += fs.readFileSync(SCHEMA_FILE, 'utf-8');
  }

  const tables = extractTableSchemas(content);

  let output = `"""
Auto-generated Pydantic models from SQLite schema.
Do not edit manually. Run 'npm run generate:schema' to update.
"""

from typing import Optional, Any
from pydantic import BaseModel

`;

  for (const table of tables) {
    const columns = parseColumns(table.body);
    output += generatePydanticModel(table.tableName, columns) + '\n';
  }

  fs.writeFileSync(OUTPUT_FILE, output);
  console.log(`Schema written to ${OUTPUT_FILE}`);
}

main();
