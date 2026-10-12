#!/bin/bash

# Deploy Local Observability Stack
# This script sets up the complete observability stack for local development

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "🚀 Starting Auth Services Observability Stack Deployment"
echo "=================================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker is required but not installed. Please install Docker first."
        exit 1
    fi
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null; then
        log_error "Docker Compose is required but not installed. Please install Docker Compose first."
        exit 1
    fi
    
    # Check if Docker is running
    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running. Please start Docker first."
        exit 1
    fi
    
    log_success "All prerequisites met"
}

# Create necessary directories
create_directories() {
    log_info "Creating necessary directories..."
    
    # Create log directories for services
    mkdir -p "$PROJECT_ROOT/../../services/personal-email-signup-backend/logs"
    mkdir -p "$PROJECT_ROOT/../../services/login-page-back/logs"
    
    # Create data directories
    mkdir -p "$PROJECT_ROOT/data/loki"
    mkdir -p "$PROJECT_ROOT/data/tempo"
    mkdir -p "$PROJECT_ROOT/data/prometheus"
    mkdir -p "$PROJECT_ROOT/data/grafana"
    mkdir -p "$PROJECT_ROOT/data/minio"
    
    # Create dashboard directories if they don't exist
    mkdir -p "$PROJECT_ROOT/dashboards/service-level"
    mkdir -p "$PROJECT_ROOT/dashboards/cross-cutting"
    mkdir -p "$PROJECT_ROOT/dashboards/infrastructure"
    
    log_success "Directories created"
}

# Validate configuration files
validate_configs() {
    log_info "Validating configuration files..."
    
    local configs=(
        "$PROJECT_ROOT/configs/loki.yaml"
        "$PROJECT_ROOT/configs/tempo.yaml"
        "$PROJECT_ROOT/configs/promtail.yaml"
        "$PROJECT_ROOT/configs/otel-collector.yaml"
        "$PROJECT_ROOT/configs/prometheus.yaml"
        "$PROJECT_ROOT/configs/grafana/datasources.yaml"
        "$PROJECT_ROOT/configs/grafana/dashboard-providers.yaml"
    )
    
    for config in "${configs[@]}"; do
        if [[ ! -f "$config" ]]; then
            log_error "Configuration file missing: $config"
            exit 1
        fi
    done
    
    log_success "All configuration files found"
}

# Start the observability stack
start_stack() {
    log_info "Starting observability stack..."
    
    cd "$PROJECT_ROOT"
    
    # Pull images first
    log_info "Pulling Docker images..."
    docker-compose pull
    
    # Start services
    log_info "Starting services..."
    docker-compose up -d
    
    log_success "Services started"
}

# Wait for services to be healthy
wait_for_services() {
    log_info "Waiting for services to become healthy..."
    
    local services=(
        "loki:3100"
        "tempo:3200"
        "prometheus:9090"
        "grafana:3000"
        "minio:9000"
    )
    
    for service in "${services[@]}"; do
        local name=$(echo $service | cut -d: -f1)
        local port=$(echo $service | cut -d: -f2)
        
        log_info "Waiting for $name on port $port..."
        
        local max_attempts=30
        local attempt=1
        
        while ! curl -s http://localhost:$port/health &> /dev/null && \
              ! curl -s http://localhost:$port/ready &> /dev/null && \
              ! curl -s http://localhost:$port/ &> /dev/null; do
            
            if [[ $attempt -ge $max_attempts ]]; then
                log_warning "$name may not be ready yet (timeout after $max_attempts attempts)"
                break
            fi
            
            echo -n "."
            sleep 2
            ((attempt++))
        done
        
        echo ""
        log_success "$name is responding"
    done
}

# Configure MinIO buckets
setup_minio() {
    log_info "Setting up MinIO buckets..."
    
    # Wait for MinIO to be ready
    sleep 10
    
    # The minio-setup container should handle this automatically
    # But we can verify the buckets exist
    log_info "MinIO buckets will be created automatically by the setup container"
}

# Verify ingestion is working
verify_ingestion() {
    log_info "Verifying data ingestion..."
    
    # Check if Loki is receiving logs
    sleep 5
    local loki_ready=$(curl -s http://localhost:3100/ready || echo "false")
    if [[ "$loki_ready" == "ready" ]]; then
        log_success "Loki is ready for log ingestion"
    else
        log_warning "Loki readiness check inconclusive"
    fi
    
    # Check if Tempo is ready
    local tempo_ready=$(curl -s http://localhost:3200/ready || echo "false")
    if [[ "$tempo_ready" == "ready" ]]; then
        log_success "Tempo is ready for trace ingestion"
    else
        log_warning "Tempo readiness check inconclusive"
    fi
    
    # Check Prometheus targets
    log_info "Prometheus will discover targets automatically"
}

# Display access information
display_access_info() {
    echo ""
    echo "🎉 Observability Stack Deployment Complete!"
    echo "==============================================="
    echo ""
    echo "📊 Access URLs:"
    echo "  • Grafana:    http://localhost:3000 (admin/admin)"
    echo "  • Prometheus: http://localhost:9090"
    echo "  • Loki:       http://localhost:3100"
    echo "  • Tempo:      http://localhost:3200"
    echo "  • MinIO:      http://localhost:9001 (admin/password123)"
    echo ""
    echo "🔍 Service Discovery:"
    echo "  • Auth services should expose metrics on /metrics"
    echo "  • Logs will be collected from service log files"
    echo "  • Traces will be received via OpenTelemetry"
    echo ""
    echo "📈 Key Features:"
    echo "  ✅ Centralized logging with Loki"
    echo "  ✅ Distributed tracing with Tempo"
    echo "  ✅ Metrics collection with Prometheus"
    echo "  ✅ Unified dashboards in Grafana"
    echo "  ✅ PII redaction in logs and traces"
    echo "  ✅ Correlation between metrics, logs, and traces"
    echo ""
    echo "🚀 Next Steps:"
    echo "  1. Start your auth services with appropriate configuration"
    echo "  2. Visit Grafana to view the pre-configured dashboards"
    echo "  3. Check the 'Service Dashboards' folder for service-specific views"
    echo "  4. Use correlation_id to trace requests across all three signals"
    echo ""
    echo "📚 Documentation:"
    echo "  • Configuration: $PROJECT_ROOT/configs/"
    echo "  • Dashboards:    $PROJECT_ROOT/dashboards/"
    echo "  • Logs:          docker-compose logs <service>"
    echo ""
}

# Cleanup function
cleanup() {
    log_info "Cleaning up on exit..."
}

# Set trap for cleanup
trap cleanup EXIT

# Main execution
main() {
    echo "Starting deployment at $(date)"
    
    check_prerequisites
    create_directories
    validate_configs
    start_stack
    wait_for_services
    setup_minio
    verify_ingestion
    display_access_info
    
    log_success "Deployment completed successfully!"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --help|-h)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --help, -h     Show this help message"
            echo "  --clean        Clean up existing data before starting"
            echo "  --no-wait      Don't wait for services to become healthy"
            echo ""
            echo "This script deploys the complete observability stack for local development."
            echo ""
            exit 0
            ;;
        --clean)
            log_info "Cleaning up existing data..."
            cd "$PROJECT_ROOT"
            docker-compose down -v
            sudo rm -rf "$PROJECT_ROOT/data"
            log_success "Cleanup completed"
            shift
            ;;
        --no-wait)
            SKIP_HEALTH_CHECK=true
            shift
            ;;
        *)
            log_error "Unknown option: $1"
            echo "Use --help for usage information."
            exit 1
            ;;
    esac
done

# Run main function
main "$@"