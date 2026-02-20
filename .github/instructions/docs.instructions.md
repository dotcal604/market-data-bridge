---
applyTo: "docs/**/*.mdx"
---
# Documentation Standards (Mintlify)

## Frontmatter
Every `.mdx` file must have:
```yaml
---
title: "Page Title"
description: "One-sentence description for SEO and nav hover"
---
```

## Evidence-Backed Claims
- If you describe runtime behavior, cite a concrete anchor:
  - Code path (file + function), OR
  - Endpoint name, OR
  - Environment variable name
- If the source is unclear, write: **"TBD (verify in code)"** — do not invent

## Mintlify Components
- Use `<Steps>`, `<Step>` for sequential instructions
- Use `<Warning>` for critical caveats
- Use `<Tip>` for helpful suggestions
- Use `<CodeGroup>` for multi-language code blocks

## Navigation
- If you add a new page, update `docs/docs.json` navigation accordingly
- Pages are organized in tabs: Guide, Frontend, MCP Tools

## Style
- Write clear and concise documentation
- Use present tense (is, open) not past tense (was, opened)
- Use active voice and second person (you)
- Include code examples where applicable
