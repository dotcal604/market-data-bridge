#!/usr/bin/env node
/**
 * Validation script to check actionsMeta parameter schemas
 */

import { actionsMeta } from './build/rest/agent.js';

console.log('Validating actionsMeta parameter schemas...\n');

let totalActions = 0;
let actionsWithParams = 0;
let actionsWithEnhancedSchemas = 0;
let actionsWithEnums = 0;
let errors = [];

for (const [actionName, meta] of Object.entries(actionsMeta)) {
  totalActions++;
  
  // Check description
  if (!meta.description || meta.description.length === 0) {
    errors.push(`${actionName}: Missing or empty description`);
  }
  
  // Check params
  if (meta.params) {
    actionsWithParams++;
    
    // Check if enhanced schema (object) vs legacy (array)
    if (!Array.isArray(meta.params)) {
      actionsWithEnhancedSchemas++;
      
      // Validate each parameter in enhanced schema
      for (const [paramName, paramSchema] of Object.entries(meta.params)) {
        if (!paramSchema.type) {
          errors.push(`${actionName}.${paramName}: Missing type field`);
        }
        
        if (!paramSchema.description) {
          errors.push(`${actionName}.${paramName}: Missing description field`);
        }
        
        if (paramSchema.enum && paramSchema.enum.length > 0) {
          actionsWithEnums++;
        }
      }
    }
  }
}

console.log(`Total actions: ${totalActions}`);
console.log(`Actions with params: ${actionsWithParams}`);
console.log(`Actions with enhanced schemas: ${actionsWithEnhancedSchemas}`);
console.log(`Actions with enum constraints: ${actionsWithEnums}`);
console.log();

if (errors.length > 0) {
  console.error(`Found ${errors.length} validation errors:\n`);
  errors.forEach(err => console.error(`  ❌ ${err}`));
  process.exit(1);
} else {
  console.log('✅ All actionsMeta schemas are valid!');
  process.exit(0);
}
