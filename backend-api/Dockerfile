FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Copy csproj files preserving the src/ folder structure for project references
COPY ["src/WebApi/WebApi.csproj", "src/WebApi/"]
COPY ["src/Infrastructure/Infrastructure.csproj", "src/Infrastructure/"]
COPY ["src/Application/Application.csproj", "src/Application/"]
COPY ["src/Domain/Domain.csproj", "src/Domain/"]
RUN dotnet restore "src/WebApi/WebApi.csproj"

COPY . .
RUN dotnet publish "src/WebApi/WebApi.csproj" -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
EXPOSE 8080

# Create the haproxy shared directory so the docker volume mount works
# and the HaproxyAclSyncService can write the ACL file and access the socket.
RUN mkdir -p /usr/local/etc/haproxy

COPY --from=build /app .
ENTRYPOINT ["dotnet", "WebApi.dll"]