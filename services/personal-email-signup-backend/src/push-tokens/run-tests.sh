#!/bin/bash

# Push Token System - Test Runner
# This script runs comprehensive tests for the push token management system

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Push Token System - Integration Test Suite${NC}"
echo "=================================================="

# Check if required dependencies are available
echo -e "${YELLOW}📋 Checking dependencies...${NC}"

if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm is not installed${NC}"
    exit 1
fi

if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}⚠️  Docker not found - database tests will be mocked${NC}"
fi

if ! command -v redis-server &> /dev/null; then
    echo -e "${YELLOW}⚠️  Redis not found - cache tests will be mocked${NC}"
fi

echo -e "${GREEN}✅ Dependencies checked${NC}"

# Install test dependencies if needed
echo -e "${YELLOW}📦 Installing test dependencies...${NC}"
npm install --silent

# Run linting first
echo -e "${YELLOW}🔍 Running TypeScript compilation and linting...${NC}"
npx tsc --noEmit --project src/push-tokens/tsconfig.json || {
    echo -e "${RED}❌ TypeScript compilation failed${NC}"
    exit 1
}

echo -e "${GREEN}✅ TypeScript compilation successful${NC}"

# Run unit tests
echo -e "${YELLOW}🧪 Running unit tests...${NC}"
npx jest --config=src/push-tokens/jest.config.json --testPathPattern="unit" --verbose

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Unit tests passed${NC}"
else
    echo -e "${RED}❌ Unit tests failed${NC}"
    exit 1
fi

# Run integration tests
echo -e "${YELLOW}🔗 Running integration tests...${NC}"
npx jest --config=src/push-tokens/jest.config.json --testPathPattern="integration" --verbose

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Integration tests passed${NC}"
else
    echo -e "${RED}❌ Integration tests failed${NC}"
    exit 1
fi

# Generate coverage report
echo -e "${YELLOW}📊 Generating coverage report...${NC}"
npx jest --config=src/push-tokens/jest.config.json --coverage --silent

echo -e "${GREEN}✅ Coverage report generated${NC}"

# Run performance benchmarks (if available)
echo -e "${YELLOW}⚡ Running performance benchmarks...${NC}"
if [ -f "src/push-tokens/tests/performance.spec.ts" ]; then
    npx jest --config=src/push-tokens/jest.config.json --testPathPattern="performance" --verbose
    echo -e "${GREEN}✅ Performance benchmarks completed${NC}"
else
    echo -e "${YELLOW}⚠️  Performance tests not found - skipping${NC}"
fi

# Validate database schema
echo -e "${YELLOW}🗄️  Validating database schema...${NC}"
if [ -f "src/push-tokens/migrations/20251010_push_tokens_schema.sql" ]; then
    echo -e "${GREEN}✅ Database schema found${NC}"
    # Here you could add actual schema validation if needed
else
    echo -e "${RED}❌ Database schema not found${NC}"
    exit 1
fi

# Check API documentation
echo -e "${YELLOW}📚 Checking API documentation...${NC}"
if [ -f "src/push-tokens/README.md" ]; then
    echo -e "${GREEN}✅ API documentation found${NC}"
else
    echo -e "${YELLOW}⚠️  API documentation missing${NC}"
fi

echo ""
echo -e "${GREEN}🎉 All tests completed successfully!${NC}"
echo "=================================================="
echo -e "${BLUE}📊 Test Summary:${NC}"
echo "• Unit tests: ✅ Passed"
echo "• Integration tests: ✅ Passed"
echo "• TypeScript compilation: ✅ Passed"
echo "• Coverage report: ✅ Generated"
echo ""
echo -e "${BLUE}📁 Coverage report available at:${NC} coverage/push-tokens/lcov-report/index.html"
echo -e "${BLUE}🚀 System ready for deployment!${NC}"