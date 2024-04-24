# pages
- [x] Landing Page
    - [x] Explore
    - [ ] Api docs
    - [x] Login
- [x] Project Manager
    - [x] View all projects
    - [x] Sub-project pages
- [ ] Todo Tracker
    - [x] Add codebase
    - [ ] View tasks
        - [ ] View all
        - [ ] By priority
        - [ ] By recent
        - [ ] In Progress

# implementation
- [x] Setup tech stack
    - [x] Astro SSR
        - [x] Github auth
        - [x] Auth middleware
    - [x] Database setup
        - [x] SQLite file (low memory impact)
        - [x] Drizzle ORM (low CPU impact)
- [ ] Deployment
    - [ ] Railway.app
    - [ ] Localhost environment
    - [ ] Reproduceable in github actions
- [ ] Testing
    - [ ] Can test locally
    - [ ] Can test in github actions
    - [ ] 70% backend coverage
    - [ ] Some crucial tests for frontend interactions

# features
- [ ] Project management
    - [ ] Move projects over from old devpad to new
    - [ ] Add API token support
- [x] Integrate todo-tracker
    - [x] Use Go binary
    - [x] Build system to clone github repo & run command


# todo tracker integration
- [ ] remove old scanned repos
- [ ] add config modification
- [ ] render diff
- [ ] if all tasks are "SAME", don't create new update
- [ ] on approve > create tasks
- [x] move project scanning to projects page
- [ ] create an interface for actually generating the tasks

# tasks
- [ ] create tables for structure
    - [x] project
    - [ ] milestone
    - [ ] goal
    - [ ] task
    - [ ] checklist
- [ ] implement MVP for first release
    - [ ] tasks
        - [ ] add checklist
        - [ ] add description
        - [ ] set start date
        - [ ] set end date
        - [ ] tag management
        - [ ] add a summary
        - [ ] set a priority
        - [ ] set visiblity
            - [ ] NESTED
            - [ ] PUBLIC
            - [ ] PRIVATE
            - [ ] ARCHIVED
            - [ ] DELETED
            - [ ] HIDDEN
            - [ ] DRAFT
    - [ ] checklist
        - [ ] easy interface for adding/removing items
        - [ ] convert to tasks easily
        - [ ] relationship with parent task
        - [ ] figure out nested checklists
        - [ ] converting from nested checklist to task
