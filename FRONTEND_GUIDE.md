# Project Task Management - Frontend Implementation Guide

Welcome to the Task Management Frontend! This guide will serve as your blueprint for integrating with the Hono.js backend. It outlines the core architecture, the exact API endpoints available, authentication handling, and state management strategies necessary to build this end-to-end task management application.

---

## 1. Architecture Overview
This application is a **Client-Server Architecture**. 
- **Backend:** A RESTful API built on Hono, utilizing PostgreSQL (Aiven) for storage and Drizzle ORM for database interactions.
- **Frontend (You):** A Single Page Application (SPA) consuming these JSON APIs.

### Recommended Frontend Stack
While the backend is completely framework-agnostic, we highly recommend:
- **Framework:** Next.js (App Router) or Vite + React
- **Styling:** TailwindCSS + Shadcn/UI for rapid, beautiful interfaces
- **Data Fetching:** TanStack Query (React Query) for automatic caching, retry logic, and easy data synchronization.
- **Form Validation:** React Hook Form + Zod (or Valibot)

---

## 2. Authentication & Authorization (Crucial!)

Our system uses **JSON Web Tokens (JWT)**. There are two tokens you need to handle:
1. `accessToken`: Short-lived (1 hour). Used to authenticate every single API request.
2. `refreshToken`: Long-lived (7 days). Used silently in the background to get a new `accessToken` when the current one expires.

### The Authentication Flow
1. **Login:** User submits Email & Password -> Backend returns `{ accessToken, refreshToken }`.
2. **Storage:**
   - Store the `accessToken` in memory (or a secure HttpOnly cookie).
   - Store the `refreshToken` in `localStorage` (or secure cookie).
3. **API Calls:** Attach the `accessToken` to the Authorization header of every request:
   `Authorization: Bearer <accessToken>`
4. **Token Expiration (The Refresh Flow):**
   If an API call returns a `401 Unauthorized` (Invalid or expired token), your frontend Axios/Fetch interceptor should *pause* the request, automatically send the `refreshToken` to `POST /api/auth/refresh`, receive a brand new `accessToken`, and instantly retry the original failed request!

### Role-Based Access Control (RBAC)
There are two roles: `ADMIN` and `DEVELOPER`.
- **ADMIN:** Powerful. Can see all users, create projects, create tasks, and assign tasks to developers.
- **DEVELOPER:** Restricted. Can only see tasks assigned to them, and can only update the `status` of their own tasks.

Your frontend UI should conditionally render elements based on the role decoded from the `accessToken` payload or the user profile response!

---

## 3. The API Routing Map

Below is the definitive list of endpoints you will interact with. Note: All endpoints are prefixed with `/api`.

### 🔐 Authentication (`/api/auth`)
- `POST /register`: Create a new account. Requires `{ name, email, password }`.
- `POST /login`: Log in to an account. Requires `{ email, password }`. Returns tokens.
- `POST /refresh`: Refresh session. Requires `{ refreshToken }`. Returns new tokens.

### 👥 Users (`/api/users`)
- `GET /`: Lists all users (**ADMIN ONLY**). Useful for populating the "Assign Task" dropdown menu!

### 📁 Projects (`/api/projects`)
- `POST /`: Create a new project (**ADMIN ONLY**). Requires `{ name, description }`.
- `GET /`: List all projects.
- `GET /:id`: Get specific project details.
- `PUT /:id`: Update a project (**ADMIN ONLY**).
- `DELETE /:id`: Delete a project (**ADMIN ONLY**).

### 📝 Tasks (`/api/tasks`)
- `POST /`: Create a new task and assign it (**ADMIN ONLY**). Requires `{ title, description, projectId, assignedTo }`.
- `GET /`: List tasks. (Admins see all tasks; Developers only see tasks assigned to them).
- `GET /:id`: Get specific task details.
- `PUT /:id`: Update a task. (**Admins** can update anything; **Developers** can ONLY update the `status` field, e.g., moving it from "PENDING" to "COMPLETED").
- `DELETE /:id`: Delete a task (**ADMIN ONLY**).

---

## 4. Suggested End-to-End Implementation Steps

If you are building the frontend from scratch, we suggest following this order of operations:

1. **Setup the App Shell:** Scaffold the React/Next.js app and set up your routing (React Router or Next App Router). Create dummy pages for Login, Dashboard, and Projects.
2. **Implement Auth Service:** Build your HTTP client (Axios or native Fetch). Create the login form, save the tokens, and implement the "Refresh Token Interceptor" (this is the hardest part, do it early!).
3. **Build the Layout:** Create a persistent sidebar/navbar that checks if a user is logged in. Add a conditional check: If `user.role === 'ADMIN'`, show the "Create Project" button.
4. **Project Management:** Build the interface to list projects. Clicking a project should open its details.
5. **Task Assignment:** On a Project details page, an Admin should see a "Create Task" button. This should open a modal that hits `GET /api/users` to fetch developers and populate a select dropdown for `assignedTo`.
6. **Kanban/Task Board:** Build the interface for Developers to view their tasks. Add drag-and-drop or a simple dropdown to `PUT /api/tasks/:id` and update a task's `status` to "IN PROGRESS" or "COMPLETED".

Happy coding! If you hit any `401` or `403` errors, double-check your token's role and expiration!
