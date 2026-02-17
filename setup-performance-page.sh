#!/bin/bash

# Setup script for Holly Performance Dashboard
# This creates the necessary directory structure and moves the page file into place

set -e

echo "Setting up Holly Performance Dashboard..."

# Create performance directory
echo "Creating directory: frontend/src/app/holly/performance"
mkdir -p frontend/src/app/holly/performance

# Move page file
echo "Moving page file..."
mv HOLLY_PERFORMANCE_PAGE.tsx frontend/src/app/holly/performance/page.tsx

# Clean up setup files
echo "Cleaning up setup files..."
rm HOLLY_PERFORMANCE_SETUP.md
rm setup-performance-page.sh

echo "✓ Holly Performance Dashboard setup complete!"
echo "  Page created at: frontend/src/app/holly/performance/page.tsx"
echo "  Visit: http://localhost:3001/holly/performance (in dev mode)"
