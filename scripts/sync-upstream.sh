#!/bin/bash

# Monorepo Upstream Sync Script
# This script automates the process of syncing upstream changes into the monorepo

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SYNC_DATE=$(date +%Y-%m-%d)
SYNC_BRANCH="sync/upstream-changes-${SYNC_DATE}"
LOG_FILE="sync-${SYNC_DATE}.log"

# Function to log messages
log() {
    if [ "$DRY_RUN" = true ]; then
        echo -e "$1"
    else
        echo -e "$1" | tee -a "${LOG_FILE}"
    fi
}

# Function to check prerequisites
check_prerequisites() {
    log "${BLUE}🔍 Checking prerequisites...${NC}"
    
    # Check if we're in the monorepo root
    if [ ! -f "SYNC.md" ]; then
        log "${RED}❌ Error: Must be run from monorepo root directory${NC}"
        exit 1
    fi
    
    # Check working directory is clean
    if [ -n "$(git status --porcelain)" ]; then
        log "${RED}❌ Error: Working directory is not clean${NC}"
        log "Please commit or stash your changes before syncing"
        git status --short
        exit 1
    fi
    
    # Check we're on main branch
    current_branch=$(git branch --show-current)
    if [ "$current_branch" != "main" ]; then
        log "${YELLOW}⚠️  Warning: Not on main branch (current: $current_branch)${NC}"
        read -p "Continue anyway? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
    
    log "${GREEN}✅ Prerequisites check passed${NC}"
}

# Function to fetch upstream changes
fetch_upstream() {
    log "${BLUE}📥 Fetching upstream changes...${NC}"
    
    # Fetch from upstream remotes
    log "Fetching upstream-login..."
    if [ "$DRY_RUN" = true ]; then
        git fetch upstream-login main --dry-run 2>&1 || git fetch upstream-login main 2>&1
    else
        git fetch upstream-login main 2>&1 | tee -a "${LOG_FILE}"
    fi
    
    log "Fetching upstream-signup..."
    if [ "$DRY_RUN" = true ]; then
        git fetch upstream-signup main --dry-run 2>&1 || git fetch upstream-signup main 2>&1
    else
        git fetch upstream-signup main 2>&1 | tee -a "${LOG_FILE}"
    fi
    
    log "${GREEN}✅ Upstream fetch completed${NC}"
}

# Function to preview changes
preview_changes() {
    log "${BLUE}👀 Previewing upstream changes...${NC}"
    
    # Check for changes in login service
    login_changes=$(git rev-list --count HEAD..upstream-login/main -- 2>/dev/null || echo "0")
    log "Login service: ${login_changes} new commits"
    
    if [ "$login_changes" -gt "0" ]; then
        log "${YELLOW}Recent login service changes:${NC}"
        if [ "$DRY_RUN" = true ]; then
            git log --oneline --max-count=5 HEAD..upstream-login/main 2>/dev/null || true
        else
            git log --oneline --max-count=5 HEAD..upstream-login/main 2>/dev/null | tee -a "${LOG_FILE}" || true
        fi
    fi
    
    # Check for changes in signup service
    signup_changes=$(git rev-list --count HEAD..upstream-signup/main -- 2>/dev/null || echo "0")
    log "Signup service: ${signup_changes} new commits"
    
    if [ "$signup_changes" -gt "0" ]; then
        log "${YELLOW}Recent signup service changes:${NC}"
        if [ "$DRY_RUN" = true ]; then
            git log --oneline --max-count=5 HEAD..upstream-signup/main 2>/dev/null || true
        else
            git log --oneline --max-count=5 HEAD..upstream-signup/main 2>/dev/null | tee -a "${LOG_FILE}" || true
        fi
    fi
    
    # Check if any changes exist
    total_changes=$((login_changes + signup_changes))
    if [ "$total_changes" -eq "0" ]; then
        log "${GREEN}✅ No upstream changes to sync${NC}"
        exit 0
    fi
    
    log "${YELLOW}Total changes to sync: ${total_changes}${NC}"
}

# Function to create sync branch
create_sync_branch() {
    log "${BLUE}🌿 Creating sync branch: ${SYNC_BRANCH}${NC}"
    
    # Pull latest main
    git pull origin main 2>&1 | tee -a "${LOG_FILE}"
    
    # Create and checkout sync branch
    git checkout -b "${SYNC_BRANCH}" 2>&1 | tee -a "${LOG_FILE}"
    
    log "${GREEN}✅ Sync branch created${NC}"
}

# Function to sync service
sync_service() {
    local service_name="$1"
    local remote_name="$2"
    local prefix="$3"
    
    log "${BLUE}🔄 Syncing ${service_name}...${NC}"
    
    # Attempt subtree pull
    if git subtree pull --prefix="${prefix}" \
        "${remote_name}" main \
        --strategy=recursive -X ours \
        -m "Sync upstream ${service_name} changes (${SYNC_DATE})" \
        2>&1 | tee -a "${LOG_FILE}"; then
        
        log "${GREEN}✅ ${service_name} sync completed successfully${NC}"
        return 0
    else
        log "${RED}❌ ${service_name} sync failed${NC}"
        return 1
    fi
}

# Function to run tests
run_tests() {
    log "${BLUE}🧪 Running validation tests...${NC}"
    
    # TypeScript compilation check
    log "Checking TypeScript compilation..."
    if npm run type-check 2>&1 | tee -a "${LOG_FILE}"; then
        log "${GREEN}✅ TypeScript compilation passed${NC}"
    else
        log "${RED}❌ TypeScript compilation failed${NC}"
        return 1
    fi
    
    # Linting check
    log "Running linter..."
    if npm run lint 2>&1 | tee -a "${LOG_FILE}"; then
        log "${GREEN}✅ Linting passed${NC}"
    else
        log "${YELLOW}⚠️  Linting issues found (non-critical)${NC}"
    fi
    
    # Basic test run
    log "Running tests..."
    if npm test 2>&1 | tee -a "${LOG_FILE}"; then
        log "${GREEN}✅ Tests passed${NC}"
    else
        log "${RED}❌ Tests failed${NC}"
        return 1
    fi
    
    log "${GREEN}✅ All validation tests completed${NC}"
}

# Function to create sync tag
create_sync_tag() {
    log "${BLUE}🏷️  Creating sync tag...${NC}"
    
    local login_commit=$(git rev-parse upstream-login/main)
    local signup_commit=$(git rev-parse upstream-signup/main)
    
    local tag_name="sync/${SYNC_DATE}"
    local tag_message="Upstream sync on ${SYNC_DATE}

Services synced:
- login-page-back: ${login_commit}
- personal-email-signup-backend: ${signup_commit}

Sync completed at: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
Log file: ${LOG_FILE}"

    git tag -a "${tag_name}" -m "${tag_message}" 2>&1 | tee -a "${LOG_FILE}"
    
    log "${GREEN}✅ Sync tag created: ${tag_name}${NC}"
}

# Function to push changes
push_changes() {
    log "${BLUE}📤 Pushing sync branch...${NC}"
    
    # Push sync branch
    git push origin "${SYNC_BRANCH}" 2>&1 | tee -a "${LOG_FILE}"
    
    # Push tags
    git push origin --tags 2>&1 | tee -a "${LOG_FILE}"
    
    log "${GREEN}✅ Changes pushed to origin${NC}"
}

# Function to show summary
show_summary() {
    log "${BLUE}📋 Sync Summary${NC}"
    log "=================================="
    log "Date: $(date)"
    log "Sync Branch: ${SYNC_BRANCH}"
    log "Log File: ${LOG_FILE}"
    log ""
    log "Next steps:"
    log "1. Review the sync branch: git checkout ${SYNC_BRANCH}"
    log "2. Create a pull request for review"
    log "3. After approval, merge to main"
    log "4. Monitor for any issues post-merge"
    log ""
    log "${GREEN}🎉 Sync process completed successfully!${NC}"
}

# Function to handle errors
handle_error() {
    local exit_code=$?
    log "${RED}❌ Sync process failed with exit code: ${exit_code}${NC}"
    log "Check the log file for details: ${LOG_FILE}"
    log ""
    log "Cleanup commands:"
    log "git checkout main"
    log "git branch -D ${SYNC_BRANCH} 2>/dev/null || true"
    log "git tag -d sync/${SYNC_DATE} 2>/dev/null || true"
    exit $exit_code
}

# Main execution
main() {
    log "${BLUE}🚀 Starting Monorepo Upstream Sync${NC}"
    log "===================================="
    log "Date: $(date)"
    log "Sync branch: ${SYNC_BRANCH}"
    log ""
    
    # Set error handler
    trap handle_error ERR
    
    # Execute sync process
    check_prerequisites
    fetch_upstream
    preview_changes
    create_sync_branch
    
    # Sync services
    sync_service "login-page-back" "upstream-login" "services/login-page-back"
    sync_service "personal-email-signup-backend" "upstream-signup" "services/personal-email-signup-backend"
    
    # Validate changes
    run_tests
    
    # Finalize sync
    create_sync_tag
    push_changes
    show_summary
}

# Help function
show_help() {
    echo "Monorepo Upstream Sync Script"
    echo ""
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  -h, --help     Show this help message"
    echo "  -n, --dry-run  Preview changes without applying them"
    echo "  -f, --force    Force sync even if working directory is dirty"
    echo "  -s, --skip-tests  Skip validation tests"
    echo ""
    echo "Examples:"
    echo "  $0                    # Normal sync"
    echo "  $0 --dry-run         # Preview only"
    echo "  $0 --skip-tests      # Sync without running tests"
    echo ""
}

# Parse command line arguments
DRY_RUN=false
FORCE=false
SKIP_TESTS=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        -n|--dry-run)
            DRY_RUN=true
            shift
            ;;
        -f|--force)
            FORCE=true
            shift
            ;;
        -s|--skip-tests)
            SKIP_TESTS=true
            shift
            ;;
        *)
            log "${RED}Unknown option: $1${NC}"
            show_help
            exit 1
            ;;
    esac
done

# Execute main function
if [ "$DRY_RUN" = true ]; then
    log "${YELLOW}🔍 DRY RUN MODE - No changes will be made${NC}"
    check_prerequisites
    fetch_upstream
    preview_changes
else
    main
fi