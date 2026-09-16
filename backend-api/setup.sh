dotnet new sln -n BackendApi
dotnet new classlib -n Domain -o src/Domain
dotnet new classlib -n Application -o src/Application
dotnet new classlib -n Infrastructure -o src/Infrastructure
dotnet new webapi -n WebApi -o src/WebApi --no-https

dotnet sln add src/Domain/Domain.csproj
dotnet sln add src/Application/Application.csproj
dotnet sln add src/Infrastructure/Infrastructure.csproj
dotnet sln add src/WebApi/WebApi.csproj

# Add project references
dotnet add src/Application/Application.csproj reference src/Domain/Domain.csproj
dotnet add src/Infrastructure/Infrastructure.csproj reference src/Application/Application.csproj
dotnet add src/WebApi/WebApi.csproj reference src/Infrastructure/Infrastructure.csproj

# Add NuGet packages
dotnet add src/WebApi/WebApi.csproj package Microsoft.EntityFrameworkCore.SqlServer
dotnet add src/WebApi/WebApi.csproj package Microsoft.EntityFrameworkCore.Tools
dotnet add src/Infrastructure/Infrastructure.csproj package Microsoft.EntityFrameworkCore.SqlServer
dotnet add src/Infrastructure/Infrastructure.csproj package Microsoft.Extensions.Caching.StackExchangeRedis
dotnet add src/Application/Application.csproj package MediatR
dotnet add src/Application/Application.csproj package AutoMapper