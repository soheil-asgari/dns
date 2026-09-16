# backend-api

ASP.NET Core Web API with Clean Architecture.

## Structure

```
src/
├── Domain/           - Enterprise business rules (entities, value objects)
├── Application/      - Application business rules (use cases, DTOs)
├── Infrastructure/   - External concerns (DB, Redis, external APIs)
└── WebApi/           - Presentation layer (controllers, middleware)
```

## Prerequisites

- .NET 8.0 SDK
- SQL Server / Redis (or Docker compose)

## Run

```bash
cd src/WebApi
dotnet run