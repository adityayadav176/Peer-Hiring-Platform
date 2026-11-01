# Peer.Hiring

### A Unified Recruitment & Hiring Platform

**Connecting Talent with Opportunities. Simplifying the Hiring Journey.**

Peer.Hiring is a full-stack recruitment platform designed to bring candidates and recruiters together through a unified hiring experience.

Traditional recruitment often involves disconnected tools for job discovery, applications, candidate evaluation, communication, interview scheduling, and interview coordination. Managing these activities across different platforms can create unnecessary friction, delays, and communication gaps.

**Peer.Hiring aims to solve this problem by bringing the essential stages of recruitment into one connected platform.**

From discovering opportunities and managing applications to communicating with recruiters and conducting real-time video interviews, Peer.Hiring creates a more organized and transparent hiring workflow for both sides.

---

## The Problem We're Solving

Recruitment is more than posting a job and collecting resumes.

Candidates often struggle with:
- Discovering relevant job opportunities.
- Keeping track of multiple job applications.
- Understanding the progress of their applications.
- Communicating with recruiters efficiently.
- Coordinating interview schedules.
- Managing interviews across different platforms.

Recruiters face a different set of challenges:
- Managing large numbers of applications.
- Reviewing candidate information and resumes.
- Organizing candidates throughout the hiring pipeline.
- Coordinating interviews with multiple applicants.
- Maintaining communication and interview records.
- Managing recruitment activities across disconnected tools.

These disconnected workflows create friction for both candidates and hiring teams.

### The Peer.Hiring Approach

Peer.Hiring brings these recruitment activities together in a centralized environment, helping candidates and recruiters manage their hiring journey without constantly switching between different tools.

---

## Platform Overview

Peer.Hiring provides dedicated experiences for candidates, recruiters, and administrators.

### For Candidates

A centralized space to discover opportunities, manage applications, and connect with recruiters.

- **Job Discovery:** Explore available opportunities and find relevant positions.
- **Application Management:** Apply for jobs and keep track of application progress.
- **Resume Management:** Manage professional resumes and share relevant information with recruiters.
- **Application Tracking:** Follow the progress of applications through different recruitment stages.
- **Recruiter Communication:** Connect with recruiters through integrated messaging.
- **Interview Management:** View scheduled interviews and participate in online interviews.
- **Real-Time Interviews:** Attend interviews through integrated video communication.

### For Recruiters

A recruitment workspace designed to simplify candidate management and hiring coordination.

- **Job Management:** Create and manage job opportunities.
- **Company Management:** Manage company-related recruitment information.
- **Applicant Management:** Access and review candidate applications.
- **Candidate Evaluation:** Track candidates through the recruitment pipeline.
- **Resume Access:** Review candidate resumes and application information.
- **Interview Scheduling:** Coordinate online interviews with candidates.
- **Real-Time Communication:** Communicate with candidates through integrated chat.
- **Interview Workspace:** Conduct online interviews with real-time video and communication capabilities.

### For Administrators

An administrative layer for managing and overseeing the platform, with role-based access and administrative authentication.

---

## Core Features

### 1. Complete Recruitment Workflow

Peer.Hiring connects the major stages of recruitment into one continuous process.

Instead of treating job discovery, applications, candidate evaluation, and interviews as isolated activities, the platform connects them through a structured hiring lifecycle.

**The hiring journey:**

```text
Job Discovery
      |
      v
Job Application
      |
      v
Application Review
      |
      v
Candidate Shortlisting
      |
      v
Interview Scheduling
      |
      v
Online Interview
      |
      v
Hiring Decision
```

This structure helps candidates and recruiters maintain visibility into the recruitment process.

### 2. Job & Application Management

The platform provides a structured environment for managing job opportunities and applications.

Candidates can discover jobs, submit applications, and monitor their progress.

Recruiters can manage job postings, review applications, and update candidate statuses as the hiring process progresses.

Application statuses represent the different stages of recruitment, making the hiring pipeline easier to understand and manage.

### 3. Resume Management

Resumes are an important part of candidate evaluation.

Peer.Hiring provides resume management capabilities that allow candidates to maintain their professional information and make resumes available during the application process.

Recruiters can access relevant candidate resume information while reviewing applications.

### 4. Real-Time Messaging

Communication gaps can slow down recruitment.

Peer.Hiring integrates real-time messaging to help candidates and recruiters communicate within the platform.

Messaging capabilities include:

- Real-time message delivery.
- Conversation management.
- Typing indicators.
- Message editing and deletion.
- File and attachment messaging.
- Message delivery receipts.
- Read receipts.
- Online presence and connection status.

Built using Socket.IO, the messaging system supports interactive communication without requiring users to repeatedly refresh the application.

### 5. Online Video Interviews

Interview coordination is one of the most important parts of recruitment.

Peer.Hiring includes an integrated online interview experience that allows recruiters and candidates to participate in scheduled video interviews.

The interview system includes:

- Interview scheduling and room management.
- Role-based interview room access.
- Real-time participant presence.
- Audio and video communication.
- WebRTC-based peer-to-peer media communication.
- Socket.IO-based signaling.
- Camera and microphone controls.
- Screen sharing.
- Interview lifecycle events.
- Candidate tab activity monitoring.

The combination of WebRTC and Socket.IO enables real-time communication while keeping interview coordination connected to the platform.

### 6. Authentication & Account Security

User accounts and access control are essential for a recruitment platform.

Peer.Hiring includes a security-focused authentication system with:

- Email and password authentication.
- JWT-based authentication.
- Access and refresh token management.
- Secure HTTP-only cookies.
- Google OAuth authentication.
- Email verification through OTP.
- Password reset workflows.
- Two-Factor Authentication (2FA).
- Session and device management.
- Login rate limiting.
- Role-based access control.

The platform supports distinct candidate, recruiter, and administrator experiences.

### 7. Notifications & User Experience

The platform is designed to keep users informed about relevant recruitment activities through notification functionality and integrated application workflows.

The goal is to reduce communication gaps and make important hiring updates easier to follow.

---

## Technology Stack

Peer.Hiring uses a modern full-stack JavaScript architecture.

| Layer | Technologies |
|---|---|
| Frontend | React.js, Vite |
| Styling | Tailwind CSS |
| Backend | Node.js, Express.js |
| Database | MongoDB |
| ODM | Mongoose |
| Real-Time Communication | Socket.IO |
| Video Communication | WebRTC |
| Authentication | JWT, OAuth 2.0 |
| Security | bcrypt, OTP, 2FA |
| Media Storage | Cloudinary |
| File Handling | Multer |
| API Communication | REST APIs |
| Version Control | Git, GitHub |

---

## System Architecture

Peer.Hiring follows a client-server architecture with separate frontend and backend responsibilities.

```text
                 PEER.HIRING
                      |
          +-----------+-----------+
          |                       |
          v                       v
     React Frontend          Admin Interface
          |
          v
      Express.js API
          |
    +-----+-------------------+
    |             |           |
    v             v           v
 MongoDB       Cloudinary   Authentication
    |                         |
    |                         v
    |                    JWT / OAuth
    |
    +-----------------------------+
    |                             |
    v                             v
Socket.IO Server             WebRTC
    |                             |
    v                             v
Real-Time Events          Video / Audio
    |
    v
Messaging, Presence,
Interview Signaling
```

The architecture separates persistent application data from real-time communication and media delivery.

- **REST APIs** handle application operations and data exchange.
- **MongoDB** stores users, jobs, applications, conversations, messages, and interview-related information.
- **Socket.IO** handles real-time messaging, presence, notifications, and interview signaling.
- **WebRTC** handles peer-to-peer audio and video communication.
- **Cloudinary** manages uploaded media assets.

---

## Engineering Highlights

Beyond its user-facing features, Peer.Hiring explores practical backend engineering concepts.

- **Role-Based Authorization:** Separates candidate, recruiter, and administrator permissions.
- **Session Management:** Supports authenticated sessions and token lifecycle management.
- **Real-Time Event Architecture:** Uses Socket.IO rooms and event-based communication.
- **WebRTC Signaling:** Coordinates peer connections through real-time signaling events.
- **Application State Management:** Maintains structured recruitment stages and candidate progress.
- **Message Lifecycle Management:** Supports delivery and read receipts, editing, and deletion.
- **Media Management:** Handles uploaded files and media assets through Cloudinary.
- **Modular Backend Design:** Separates routes, controllers, models, middleware, and utility logic.

---

## Why Peer.Hiring?

Peer.Hiring is built around a simple idea:

**The recruitment process should feel like one connected journey, not a collection of disconnected tools.**

By combining job management, application tracking, candidate evaluation, communication, and online interviews, the platform aims to reduce operational friction for recruiters and make the hiring journey more organized for candidates.

It also explores how real-time technologies can be integrated into a practical full-stack product rather than being used as isolated technical demonstrations.

---

## Future Improvements

Peer.Hiring is an evolving platform. Potential improvements include:

- Advanced job recommendation and matching.
- Intelligent resume parsing and candidate-job matching.
- Advanced recruiter analytics and hiring insights.
- Calendar integration and automated interview reminders.
- Interview recording and controlled playback.
- Advanced search and filtering.
- Scalable real-time infrastructure.
- Improved deployment, monitoring, and observability.

---

## Getting Started

### Prerequisites

- Node.js
- npm
- MongoDB
- Cloudinary account
- Google OAuth credentials (if using Google authentication)

### Clone the Repository

```bash
git clone <https://github.com/adityayadav176/Peer-Hiring-Platform.git>
cd Peer.Hiring
```

Install dependencies in the frontend and backend directories, configure the required environment variables, and start the development servers using the respective project scripts.

Refer to the frontend and backend configuration files for the required environment variables.

**Never commit secrets, database credentials, OAuth keys, or environment files to version control.**

---

## Project Status

Peer.Hiring is an actively developed full-stack recruitment platform.

Core recruitment workflows, authentication, messaging, and online interview functionality are implemented. Further improvements are planned to strengthen the platform's usability, reliability, and scalability.

---

## Author

**Aditya Yadav**

Full-Stack Developer

GitHub: [@adityayadav176](https://github.com/adityayadav176)

---

*Peer.Hiring — Bringing the hiring journey together.*