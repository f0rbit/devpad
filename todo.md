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
- [x] on approve > create tasks
    - [x] currently modifies codebase_tasks
    - [x] we want to cross-check with current tasks in project and update if necessary
- [x] move project scanning to projects page
- [ ] create an interface for actually generating the tasks

# tasks
- [ ] create tables for structure
    - [x] project
    - [x] milestone
    - [x] goal
    - [x] task
    - [x] checklist
- [ ] implement MVP for first release
    - [ ] tasks
        - [ ] add checklist
        - [ ] add description
        - [ ] set start date
        - [ ] set end date
        - [ ] tag management
            - [ ] tags are scoped per-user
            - [ ] any task the user owns can be assigned to any tag the user owns
            - [ ] tags should have a 'colour' field & title
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
    - [x] linking tasks to codebases
        - [x] each task should have 'codebase_info'
        - [x] new table stores following information
            - [x] tag (note, todo, bug, fixme)
            - [x] text from the line of code
            - [x] file name
            - [x] line number inside file

## structure of project/tasks relationship
project > milestone > goal > task > checklists
basically each project can have multiple milestones, these milestones will be associated with a 'version' string, that when the user marks a milestone as complete will update the project.
each milestone is comprised of multiple goals, which are essentially just grouped tasks. goals can have their own due dates but no start dates, and the due dates are optional. goals have a title & summary. goals will have a 'completed' date field which would indicate when the user marked the goal as completed.
tasks are made of many different fields, outlined above. They also contain links to checklists. This is a complex relationship as a checklist's can be nested within other checklists, but the root checklist will be linked to only 1 task. A task can have multiple checklist instances however.

