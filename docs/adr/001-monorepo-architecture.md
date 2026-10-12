# ADR-001: Monorepo Architecture

## Status
- **Status**: Accepted
- **Date**: 2025-10-10
- **Decision Makers**: @devops-team-lead, @engineering-manager, @backend-team-lead
- **Consulted**: @auth-team, @signup-team, @security-team
- **Informed**: All engineering teams

## Context

The auth services ecosystem has grown to include multiple related services:
- Personal email signup backend (NestJS)
- Login page backend (Express/NestJS)
- Shared libraries and utilities
- Common infrastructure and deployment scripts

Previously, these services existed in separate repositories, leading to:
- **Code Duplication**: Shared utilities copied between repos
- **Dependency Management**: Difficult to coordinate breaking changes
- **CI/CD Complexity**: Multiple pipelines to maintain
- **Release Coordination**: Complex cross-service deployments
- **Developer Experience**: Context switching between repositories

## Decision

Adopt a monorepo architecture for all authentication-related services using:
- **Single repository**: `auth-services-monorepo` containing all services
- **Service isolation**: Each service maintains independent build/test/deploy cycles
- **Shared components**: Common utilities in `src/` directory
- **Path-based CI**: Selective builds based on changed files
- **Independent versioning**: Services can be versioned and released independently

## Rationale

### Benefits of Monorepo
1. **Simplified Dependency Management**: Shared dependencies managed centrally
2. **Atomic Changes**: Cross-service changes in single commit/PR
3. **Code Sharing**: Reduced duplication through shared libraries
4. **Consistent Tooling**: Unified linting, testing, and deployment tools
5. **Easier Refactoring**: Safe cross-service refactoring
6. **Developer Productivity**: Single clone, single IDE workspace

### Monorepo vs Alternatives
- **Multi-repo**: Rejected due to coordination overhead
- **Package repositories**: Too complex for current team size
- **Git submodules**: Poor developer experience and complexity

### Path Filtering Strategy
- Changes to `services/personal-email-signup-backend/` trigger only signup CI
- Changes to `services/login-page-back/` trigger only login CI  
- Changes to `src/`, `scripts/`, or root files trigger all service CIs
- Emergency changes can trigger full CI with special commit syntax

## Consequences

### Positive
- **Reduced Context Switching**: Developers work in single repository
- **Simplified CI/CD**: Single pipeline configuration with path filtering
- **Easier Code Reviews**: Cross-service changes visible in single PR
- **Dependency Coordination**: Breaking changes coordinated across services
- **Shared Tooling**: Consistent linting, formatting, and quality tools
- **Documentation Centralization**: All docs in single location

### Negative
- **Repository Size**: Larger repository with more files
- **Clone Time**: Slightly longer initial clone time
- **Build Complexity**: More sophisticated CI configuration required
- **Merge Conflicts**: Potential for conflicts in shared areas
- **Access Control**: Coarser-grained access control (repo-level)

### Neutral
- **Learning Curve**: Team needs to understand monorepo patterns
- **Tooling Changes**: Migration from multi-repo tools and workflows
- **Git History**: Existing history preserved through migration scripts

## Alternatives Considered

### Multi-Repository (Status Quo)
- **Pros**: Service isolation, independent access control
- **Cons**: Code duplication, coordination overhead, complex CI/CD
- **Verdict**: Rejected due to maintenance burden

### Lerna/Nx Monorepo
- **Pros**: Sophisticated tooling, dependency graph management
- **Cons**: Additional complexity, learning curve, tool overhead
- **Verdict**: Rejected as over-engineered for current needs

### Git Submodules
- **Pros**: Maintains separate repositories
- **Cons**: Complex workflow, poor developer experience
- **Verdict**: Rejected due to complexity

### Package Repository
- **Pros**: True dependency management
- **Cons**: Complex setup, versioning overhead
- **Verdict**: Rejected as premature optimization

## Implementation

### Timeline
- **Week 1**: Repository setup and migration scripts
- **Week 2**: CI/CD pipeline implementation with path filtering
- **Week 3**: Team training and documentation
- **Week 4**: Full migration and old repository archival

### Effort
- **Estimated**: 3-4 weeks
- **Team**: 2 DevOps engineers, 1 backend engineer
- **Risk Level**: Medium (migration complexity)

### Dependencies
- **Prerequisites**: 
  - Git history migration strategy
  - CI/CD path filtering implementation
  - Team training on monorepo workflows
- **External Dependencies**: None

### Migration Strategy
1. **Create new monorepo**: Initialize with proper structure
2. **Migrate git history**: Preserve commit history for each service
3. **Update CI/CD**: Implement path filtering and selective builds
4. **Update documentation**: Monorepo-specific contribution guidelines
5. **Team training**: Workshops on new workflows
6. **Gradual migration**: Move services one at a time
7. **Archive old repos**: Redirect to monorepo

### Risks
- **Migration complexity**: Git history preservation challenges
- **CI/CD bugs**: Path filtering logic errors
- **Team adoption**: Resistance to workflow changes
- **Performance impact**: Larger repository affecting tools

### Mitigation Strategies
- **Extensive testing**: CI/CD pipelines tested before migration
- **Rollback plan**: Keep old repositories accessible during transition
- **Training program**: Comprehensive documentation and workshops
- **Gradual rollout**: Migrate services incrementally

## Monitoring and Review

### Success Metrics
- **Developer Productivity**: Reduced time for cross-service changes
- **CI/CD Performance**: Build times comparable to multi-repo
- **Code Quality**: Reduced duplication, increased shared component usage
- **Team Satisfaction**: Developer survey scores
- **Deployment Frequency**: Maintained or improved deployment cadence

### Key Performance Indicators
- Build time per service (target: <5 minutes)
- PR review time (target: <24 hours)
- Cross-service change frequency (baseline: current state)
- Code duplication metrics (target: 50% reduction)
- Developer onboarding time (target: <2 days)

### Review Schedule
- **30 days**: Initial assessment of migration success
- **90 days**: Comprehensive review of metrics and team feedback
- **6 months**: Full evaluation and potential optimization
- **Annual**: Strategic review of monorepo vs alternatives

### Monitoring Tools
- **CI/CD Metrics**: GitHub Actions analytics
- **Code Quality**: SonarQube or CodeClimate
- **Developer Experience**: Team surveys and interviews
- **Performance**: Repository and build performance tracking

### Review Criteria
- All success metrics met or trending positive
- No significant performance degradation
- Team satisfaction with new workflows
- Reduced operational overhead

### Owner and Responsibilities
- **Primary Owner**: @devops-team-lead
- **Technical Implementation**: @devops-team
- **Change Management**: @engineering-manager
- **Success Metrics**: @devops-team-lead
- **Review Coordination**: @docs-team

## References

### Internal Documentation
- [Monorepo Migration Plan](../deployment/monorepo-migration.md)
- [CI/CD Path Filtering Guide](../ci-cd/path-filtering.md)
- [Shared Libraries Guidelines](../development/shared-libraries.md)

### External Resources
- [Google's Monorepo Approach](https://research.google/pubs/pub45424/)
- [Monorepo Best Practices](https://monorepo.tools/)
- [GitHub Actions Path Filtering](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#onpushpull_requestpull_request_targetpathspaths-ignore)

### Discussion Archives
- [RFC: Monorepo Architecture](https://github.com/company/rfcs/issues/42)
- [Team Discussion: Build Strategy](https://company.slack.com/archives/C123456/p1633024800)

## Notes

### Design Principles
1. **Service Independence**: Each service can be built, tested, and deployed independently
2. **Selective Execution**: Only run CI/CD for changed components
3. **Shared Ownership**: Common components owned by all teams
4. **Gradual Migration**: Incremental adoption without big-bang changes
5. **Tool Consistency**: Unified development experience across services

### Future Considerations
- **Service Extraction**: Plan for extracting services if they grow too large
- **Access Control**: Evaluate fine-grained access control solutions
- **Build Optimization**: Consider build caching and parallelization
- **Dependency Management**: Monitor for dependency conflicts
- **Scaling Strategy**: Plan for additional services joining the monorepo

### Lessons Learned
- Path filtering complexity higher than anticipated
- Team training crucial for successful adoption
- Clear ownership boundaries essential for shared components
- Regular review cycles important for continuous improvement

---

**Document Version**: 1.0  
**Last Updated**: October 10, 2025  
**Next Review**: January 10, 2026