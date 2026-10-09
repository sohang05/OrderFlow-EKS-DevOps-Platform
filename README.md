# OrderFlow --- AWS EKS DevOps Platform

A containerized order-management application deployed to Amazon EKS with
Terraform-managed infrastructure, Amazon ECR image storage, Helm-based
Kubernetes releases, GitHub Actions CI/CD, and monitoring with
Prometheus, Grafana, and Amazon CloudWatch.

> **Project type:** Hands-on cloud/DevOps portfolio project\
> **AWS Region:** `us-east-1`\
> **Kubernetes namespace:** `orderflow`

## Table of contents

-   [Objective](#objective)
-   [Architecture](#architecture)
-   [Tools and why they were used](#tools-and-why-they-were-used)
-   [Application overview](#application-overview)
-   [Repository structure](#repository-structure)
-   [How the architecture works](#how-the-architecture-works)
-   [CI/CD workflow](#cicd-workflow)
-   [Infrastructure and security](#infrastructure-and-security)
-   [Monitoring and autoscaling](#monitoring-and-autoscaling)
-   [Common commands and why they are
    used](#common-commands-and-why-they-are-used)
-   [Issues encountered and fixes](#issues-encountered-and-fixes)
-   [Troubleshooting scenarios](#troubleshooting-scenarios)
-   [Future improvements](#future-improvements)
-   [Important security notes](#important-security-notes)

## Objective

The objective was to take a working web application and move it through
a realistic deployment path:

1.  Run the application locally and verify its frontend, backend, and
    PostgreSQL database.
2.  Containerize the frontend and backend with Docker and test them
    together.
3.  Provision AWS networking, Amazon EKS, and Amazon RDS with reusable
    Terraform modules.
4.  Store versioned container images in Amazon ECR.
5.  Deploy the application to Kubernetes using Helm.
6.  Automate image build, push, and deployment with GitHub Actions.
7.  Add monitoring, logs, and horizontal pod autoscaling.
8.  Document real troubleshooting experiences and the commands used to
    diagnose them.

The project demonstrates practical skills in cloud infrastructure,
containerization, Kubernetes operations, infrastructure as code, CI/CD,
identity and access management, monitoring, and incident
troubleshooting.

## Architecture

The architecture diagram below is written in Mermaid, so GitHub can
render it directly in this README.

``` mermaid
flowchart TB
    User[User's browser] -->|HTTP :80| ALB[AWS Application Load Balancer]
    ALB --> Ingress[Kubernetes Ingress]
    Ingress --> FrontSvc[Frontend ClusterIP Service]
    FrontSvc --> Front[Nginx frontend pods]
    Front -->|/api requests| BackSvc[Backend ClusterIP Service]
    BackSvc --> Back[Python backend pods :8000]
    Back -->|Private TCP :5432| RDS[(Amazon RDS PostgreSQL)]

    subgraph AWS[AWS account - us-east-1]
      subgraph VPC[Custom VPC]
        subgraph Private[Private subnets]
          EKS[Amazon EKS control plane]
          Nodes[Managed node group - EC2 worker nodes]
          FrontSvc
          BackSvc
          Front
          Back
          RDS
        end
        ALB
      end
      ECR[Amazon ECR image repositories]
    end

    Dev[Developer pushes code] --> GitHub[GitHub repository]
    GitHub --> Actions[GitHub Actions workflow]
    Actions -->|OIDC assumes IAM role| IAM[AWS IAM role]
    Actions -->|Build and push commit-SHA images| ECR
    Actions -->|Helm deployment and rollout checks| EKS
    ECR -->|Images pulled by nodes| Nodes

    Prom[Prometheus] -. scrape metrics .-> Nodes
    Prom -. scrape metrics .-> Front
    Prom -. scrape metrics .-> Back
    Grafana[Grafana dashboards] --> Prom
    CW[Amazon CloudWatch Logs and alarms] -. operational logs/alarms .-> AWS
```

### Request flow

1.  A user opens the application through the AWS Application Load
    Balancer.
2.  The Ingress routes traffic to the frontend Kubernetes Service.
3.  Nginx serves the static HTML, CSS, and JavaScript files.
4.  Requests under `/api` are forwarded to the backend Kubernetes
    Service.
5.  The Python backend handles application logic and connects privately
    to PostgreSQL on Amazon RDS.
6.  Kubernetes Services provide stable internal DNS names, so pods do
    not need to know one another's IP addresses.

### CI/CD flow

``` mermaid
flowchart LR
    A[Developer commit and push] --> B[GitHub Actions]
    B --> C[Authenticate to AWS using OIDC]
    C --> D[Build frontend and backend images]
    D --> E[Push images tagged with commit SHA to ECR]
    E --> F[Configure kubectl access to EKS]
    F --> G[Deploy/update Helm release]
    G --> H[Wait for Kubernetes rollout]
    H --> I[Read Ingress hostname and test endpoint]
```

## Tools and why they were used

  -----------------------------------------------------------------------
  Tool or service                     Why it was used
  ----------------------------------- -----------------------------------
  AWS VPC                             Provides isolated networking for
                                      the application infrastructure.

  Public and private subnets          Separate the internet-facing load
                                      balancer from private application
                                      and database resources.

  Security Groups                     Control network traffic between the
                                      load balancer, EKS workloads, and
                                      RDS.

  NAT Gateway                         Provides outbound access for
                                      private subnet resources when
                                      required, without assigning them
                                      public IP addresses.

  Amazon EKS                          Runs and manages the Kubernetes
                                      control plane for the containerized
                                      application.

  EC2 managed node group              Provides worker compute capacity on
                                      which Kubernetes pods run.

  Amazon ECR                          Stores frontend and backend Docker
                                      images.

  Amazon RDS for PostgreSQL           Provides a managed relational
                                      database outside the application
                                      pods.

  Terraform                           Defines repeatable infrastructure
                                      as code and separates
                                      infrastructure into reusable
                                      modules.

  S3 Terraform backend                Stores Terraform state remotely for
                                      consistent access and recovery.

  DynamoDB state locking              Prevents concurrent Terraform
                                      operations from modifying the same
                                      state at the same time.

  Docker                              Packages the frontend and backend
                                      with their runtime dependencies.

  Docker Compose                      Runs the application and PostgreSQL
                                      locally for integration testing
                                      before cloud deployment.

  Kubernetes Deployments              Maintain the desired number of
                                      frontend and backend pod replicas
                                      and support rolling updates.

  Kubernetes Services                 Provide stable networking and
                                      service discovery for pods. The
                                      backend is internal to the cluster.

  Kubernetes ConfigMap                Stores non-sensitive database
                                      connection configuration.

  Kubernetes Secret                   Supplies database credentials
                                      separately from application images
                                      and ordinary configuration.

  Kubernetes Ingress and AWS Load     Connect external HTTP traffic to
  Balancer Controller                 the frontend workload through an
                                      AWS load balancer.

  Helm                                Packages Kubernetes resources into
                                      a reusable chart with parameterized
                                      values.

  GitHub Actions                      Automates image builds, publishing
                                      to ECR, Helm deployment, rollout
                                      checks, and endpoint validation.

  GitHub OIDC and AWS IAM             Let the workflow obtain temporary
                                      AWS credentials without storing
                                      long-lived AWS access keys in
                                      GitHub secrets.

  Metrics Server                      Supplies resource metrics required
                                      by CPU-based Horizontal Pod
                                      Autoscaler decisions and
                                      `kubectl top`.

  Horizontal Pod Autoscaler (HPA)     Scales backend replicas based on
                                      observed CPU utilization, within
                                      configured minimum and maximum
                                      limits.

  Prometheus                          Collects and queries infrastructure
                                      and Kubernetes metrics.

  Grafana                             Displays metrics in dashboards for
                                      operational visibility.

  kube-prometheus-stack               Installs Prometheus, Grafana,
                                      Alertmanager, Node Exporter,
                                      kube-state-metrics, and related
                                      monitoring components through Helm.

  Amazon CloudWatch                   Collects available EKS/container
                                      logs and provides alarms such as
                                      the RDS CPU alarm.

  kubectl and AWS CLI                 Inspect and operate Kubernetes and
                                      AWS resources from the command
                                      line.
  -----------------------------------------------------------------------

## Application overview

OrderFlow is an order-management web application with customer and
administrator workflows.

-   Browse products and categories.
-   Register, log in, and log out.
-   Add products to a cart and place orders.
-   Track order details and statuses.
-   Administer products, categories, orders, and users.

### Application tiers

-   **Frontend:** Static HTML, CSS, and JavaScript served by Nginx on
    port `80`.
-   **Backend:** Python application using the standard-library
    `http.server` server and exposing its API on port `8000`. It is not
    a FastAPI application.
-   **Database:** PostgreSQL, hosted on Amazon RDS in the AWS
    deployment.

The backend uses Psycopg 3 to connect to PostgreSQL. The database is not
intended to be publicly accessible; application-to-database traffic uses
private networking and TCP port `5432`.

## Repository structure

The main repository layout is:

``` text
orderflow-app/
├── .github/
│   └── workflows/                 # GitHub Actions CI/CD workflow
├── application/
│   ├── backend/                   # Python API, database/auth code, Dockerfile
│   └── frontend/                  # HTML, CSS, JavaScript, Nginx config, Dockerfile
├── docs/
│   ├── architecture/              # Architecture diagrams
│   └── screenshots/
│       ├── application/
│       ├── eks/
│       ├── cicd/
│       ├── monitoring/
│       └── cloudwatch/
├── helm/
│   └── orderflow/
│       ├── Chart.yaml
│       ├── values.yaml
│       └── templates/
│           ├── backend-deployment.yaml
│           ├── backend-hpa.yaml
│           ├── backend-service.yaml
│           ├── configmap.yaml
│           ├── frontend-deployment.yaml
│           ├── frontend-service.yaml
│           └── ingress.yaml
├── kubernetes/                    # Supporting Kubernetes manifests
├── terraform/
│   ├── modules/
│   │   ├── vpc/
│   │   ├── eks/
│   │   └── rds/
│   └── ...                        # Root Terraform configuration
├── terraform-bootstrap/           # Remote state and locking bootstrap
├── docker-compose.yml             # Local multi-container development
├── .gitignore
└── README.md
```

The exact filenames can vary as the repository evolves. Keep Terraform
state, local `.terraform` directories, local variable files containing
secrets, kubeconfig files, and credentials out of version control.

## How the architecture works

### AWS network and compute

Terraform provisions a VPC with public and private subnet separation.
The AWS load balancer is the external entry point. EKS worker nodes and
application pods run in private subnets. RDS is also private and is
protected by its security group.

Security groups should allow only the traffic required between tiers. In
particular, PostgreSQL port `5432` should be allowed from the
application/EKS security boundary rather than from the entire internet.

### EKS workloads

The `orderflow` namespace contains the application resources.
Deployments maintain the desired pod replica counts, Services provide
stable internal names, and probes determine whether containers are ready
and healthy. The backend uses a ClusterIP Service because it is an
internal tier. The frontend is exposed through an Ingress backed by an
AWS load balancer.

### Configuration and credentials

Non-sensitive settings such as database host, port, and database name
belong in a ConfigMap. Database username and password belong in a
Kubernetes Secret. The password must not be placed in a Docker image,
Helm values file, Git repository, or log output.

### Terraform state

Terraform state is stored in an S3 backend, with DynamoDB used for state
locking in this project setup. Remote state supports consistent
infrastructure management, while locking reduces the risk of
simultaneous changes corrupting the state workflow.

## CI/CD workflow

The project uses GitHub Actions to automate deployment when code is
pushed to the configured branch.

1.  **Trigger:** A commit is pushed to the repository/branch configured
    in the workflow.
2.  **Checkout:** GitHub Actions checks out the source code.
3.  **AWS authentication:** The workflow uses GitHub OIDC to assume a
    dedicated AWS IAM role. Long-lived AWS access keys are not required.
4.  **Build:** Docker builds separate frontend and backend images.
5.  **Publish:** Images are pushed to the `orderflow-frontend` and
    `orderflow-backend` ECR repositories.
6.  **Image versioning:** Images use the Git commit SHA as a tag. This
    makes the deployed image traceable to a specific source revision and
    avoids relying only on a mutable `latest` tag.
7.  **Cluster access:** The workflow configures access to the EKS
    cluster using the AWS CLI and Kubernetes access configuration.
8.  **Deployment:** Helm installs or upgrades the `orderflow` release
    with the new image references.
9.  **Rollout validation:** The workflow waits for Kubernetes
    deployments to complete.
10. **Endpoint validation:** It reads the current hostname from the
    Ingress resource and tests the application endpoint rather than
    relying on a hardcoded load balancer hostname.

### Identity and permissions are separate checks

When diagnosing pipeline access, check these layers in order:

1.  **OIDC trust policy:** Is this GitHub repository and branch allowed
    to assume the role?
2.  **AWS IAM permissions:** Can the assumed role perform the required
    ECR and EKS API actions?
3.  **EKS access:** Is the role recognized by the cluster's access
    configuration?
4.  **Kubernetes authorization:** Can that identity change the required
    resources in the `orderflow` namespace?
5.  **Resource configuration:** Are repository names, image tags,
    namespace, chart paths, and deployment names correct?

An AWS role can be assumed successfully and still receive a Kubernetes
`Forbidden` error if cluster access or Kubernetes authorization is
missing.

## Monitoring and autoscaling

### Prometheus and Grafana

The `kube-prometheus-stack` was installed through Helm into a dedicated
`monitoring` namespace. The stack includes Prometheus, Grafana,
Alertmanager, Node Exporter, and kube-state-metrics.

-   **Prometheus** collects and queries metrics.
-   **Grafana** visualizes metrics in dashboards.
-   **Node Exporter** exposes host-level metrics.
-   **kube-state-metrics** exposes Kubernetes object state.
-   **Alertmanager** handles alerts generated by the monitoring stack.

Monitoring was configured with resource limits appropriate for the small
development cluster. Prometheus retention was kept limited to reduce
storage/resource usage.

### Metrics Server and HPA

Metrics Server provides resource metrics to Kubernetes. The backend HPA
is configured with a CPU target of `60%`, a minimum of `2` replicas, and
a maximum of `5` replicas. During validation, controlled CPU load was
generated and the HPA scaled replicas up; after the load was removed, it
could scale back toward the minimum.

Use CPU-load commands only in a controlled test window, then stop the
load process.

### CloudWatch

CloudWatch log groups for EKS/container observability were present,
including application and host/dataplane-related log groups. An RDS CPU
alarm named `OrderFlow-RDS-High-CPU` was also configured and was
observed in `OK` state during validation.

CloudWatch log availability depends on the installed/active log
collection agents and their configuration. Verify the actual log streams
before assuming every log type is being collected.

## Common commands and why they are used

Commands below use PowerShell where line continuation is shown with a
backtick. Replace placeholders such as `<pod-name>` with real values
from your cluster.

### Docker and local development

  --------------------------------------------------------------------------------------------------------------
  Command                                                                    Purpose
  -------------------------------------------------------------------------- -----------------------------------
  `docker compose up -d --build`                                             Build images and start local
                                                                             services in the background.

  `docker compose ps`                                                        Check which local containers are
                                                                             running.

  `docker compose logs -f`                                                   Follow logs from local services
                                                                             while reproducing an issue.

  `docker logs -f <container-name>`                                          Inspect logs for one container.

  `docker exec -it orderflow-postgres psql -U orderflow_user -d orderflow`   Open an interactive PostgreSQL
                                                                             shell inside the local database
                                                                             container.

  `docker stop <container-name>`                                             Stop a running container.

  `docker rm <container-name>`                                               Remove a stopped container.

  `docker images`                                                            List local images.
  --------------------------------------------------------------------------------------------------------------

### AWS CLI and ECR

``` powershell
aws sts get-caller-identity
```

Shows which AWS identity the CLI is currently using.

``` powershell
aws eks update-kubeconfig --region us-east-1 --name orderflow-dev
```

Adds/updates the local kubeconfig context for the EKS cluster. This
operation requires the AWS API permission `eks:DescribeCluster`.

``` powershell
aws ecr describe-repositories --repository-names orderflow-backend orderflow-frontend --region us-east-1 --query "repositories[].{Name:repositoryName,URI:repositoryUri}" --output table
```

Confirms that the ECR repositories exist and displays their URIs.

``` powershell
aws eks describe-cluster --name orderflow-dev --region us-east-1 --query "cluster.status"
```

Checks the EKS cluster status.

### Kubernetes basics

  ---------------------------------------------------------------------------------------------------------
  Command                                                               Purpose
  --------------------------------------------------------------------- -----------------------------------
  `kubectl config current-context`                                      Confirm which cluster/context
                                                                        kubectl will use.

  `kubectl get nodes -o wide`                                           Check worker node readiness, IPs,
                                                                        versions, and node details.

  `kubectl get pods -A`                                                 Inspect pods across all namespaces.

  `kubectl get all -n orderflow`                                        Get a quick view of common
                                                                        application resources in the
                                                                        namespace.

  `kubectl get deploy,svc,ingress -n orderflow`                         Inspect deployments, services, and
                                                                        ingress routing.

  `kubectl describe pod <pod-name> -n orderflow`                        Inspect pod events, scheduling,
                                                                        probes, image pulls, and container
                                                                        state.

  `kubectl logs <pod-name> -n orderflow`                                Read the current container logs.

  `kubectl logs <pod-name> -n orderflow --previous`                     Read logs from the previous
                                                                        container instance after a restart.

  `kubectl get events -n orderflow --sort-by='.lastTimestamp'`          Find recent namespace events in
                                                                        time order.

  `kubectl rollout status deployment/orderflow-backend -n orderflow`    Wait for and verify backend rollout
                                                                        completion.

  `kubectl rollout history deployment/orderflow-backend -n orderflow`   Inspect rollout revisions.

  `kubectl get ingress orderflow-ingress -n orderflow -o wide`          Inspect the Ingress and its
                                                                        assigned load balancer hostname.

  `kubectl get hpa -n orderflow`                                        Check autoscaler targets and
                                                                        replica counts.

  `kubectl top nodes`                                                   Check node CPU and memory usage
                                                                        (requires Metrics Server).

  `kubectl top pods -n orderflow`                                       Check pod CPU and memory usage
                                                                        (requires Metrics Server).
  ---------------------------------------------------------------------------------------------------------

To read the current Ingress hostname in PowerShell:

``` powershell
$HOSTNAME = kubectl get ingress orderflow-ingress -n orderflow -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
$HOSTNAME
```

To follow backend logs:

``` powershell
kubectl logs -n orderflow deployment/orderflow-backend -f
```

To inspect the Deployment and its recent events:

``` powershell
kubectl describe deployment orderflow-backend -n orderflow
kubectl get events -n orderflow --sort-by='.lastTimestamp' | Select-Object -Last 15
```

### Helm

  -------------------------------------------------------------------------------------------------------------------------
  Command                                                                               Purpose
  ------------------------------------------------------------------------------------- -----------------------------------
  `helm lint .\helm\orderflow`                                                          Validate chart structure and
                                                                                        template syntax.

  `helm template orderflow .\helm\orderflow`                                            Render Kubernetes YAML locally
                                                                                        without deploying it.

  `helm list -n orderflow`                                                              List Helm releases in the
                                                                                        application namespace.

  `helm status orderflow -n orderflow`                                                  Inspect the deployed release
                                                                                        status.

  `helm history orderflow -n orderflow`                                                 Review Helm release revisions.

  `helm upgrade --install orderflow .\helm\orderflow -n orderflow --create-namespace`   Install the release or update it if
                                                                                        it already exists.

  `helm get values orderflow -n orderflow`                                              Inspect values used by the release.
  -------------------------------------------------------------------------------------------------------------------------

Validate templates with `helm lint` and `helm template` before upgrading
a live release.

### Terraform

Run Terraform commands from the correct root configuration directory.

``` powershell
terraform fmt -recursive
terraform validate
terraform plan
```

-   `fmt` formats Terraform files.
-   `validate` checks configuration syntax and internal consistency.
-   `plan` previews intended changes before they are applied.

Use `terraform apply` only after reviewing the plan and confirming the
intended environment. Never delete or recreate production resources as a
troubleshooting shortcut.

### Monitoring port-forwarding

``` powershell
kubectl port-forward -n monitoring svc/monitoring-grafana 3000:80
```

Opens Grafana locally at `http://localhost:3000` while the command is
running.

``` powershell
kubectl port-forward -n monitoring svc/monitoring-kube-prometheus-prometheus 9090:9090
```

Opens Prometheus locally at `http://localhost:9090`.

To inspect monitoring pods:

``` powershell
kubectl get pods -n monitoring
```

## Issues encountered and fixes

The following table summarizes the actual project notes and
troubleshooting log. Some fixes apply to the stage where the issue
occurred; check current resource names and versions before reusing
commands.

  --------------------------------------------------------------------------------------------
  Issue                         Root cause                         Fix / lesson
  ----------------------------- ---------------------------------- ---------------------------
  Local app needed to move from The target AWS design uses managed Migrated the database
  SQLite to PostgreSQL          PostgreSQL rather than an embedded connection layer to
                                SQLite database.                   PostgreSQL/Psycopg and
                                                                   tested PostgreSQL locally
                                                                   before introducing AWS and
                                                                   EKS.

  RDS instance could not        AWS returned                       Restored a database
  restart in its original       `InsufficientDBInstanceCapacity`   snapshot into a supported
  Availability Zone             for the selected instance          instance/AZ and validated
                                class/AZ.                          connectivity. Keep a
                                                                   recovery path and verify
                                                                   the new endpoint.

  Backend couldn't connect to   RDS security group did not allow   Added a narrowly scoped
  RDS                           PostgreSQL traffic from the EKS    inbound TCP `5432` rule
                                security boundary.                 from the appropriate
                                                                   security group; do not open
                                                                   PostgreSQL to `0.0.0.0/0`.

  Database password with `@`    The selected password characters   Generated a compliant
  was rejected by the chosen    were not accepted in that          password, updated the
  password configuration path   configuration path.                database and Kubernetes
                                                                   Secret consistently, and
                                                                   avoided printing the secret
                                                                   in logs or source control.

  PostgreSQL schema/data did    The database schema and seed data  Recreated/updated the
  not match what the            were not aligned with the current  schema and seed data, then
  application expected          application.                       tested application
                                                                   operations against
                                                                   PostgreSQL.

  Python Decimal value could    PostgreSQL numeric values were     Converted response values
  not be serialized to JSON     returned as `Decimal`, which the   to JSON-compatible types at
                                JSON encoder did not serialize by  the API boundary and
                                default.                           retested affected
                                                                   endpoints.

  PostgreSQL insert ID handling Psycopg 3/PostgreSQL do not        Use PostgreSQL
  failed                        provide SQLite-style               `INSERT ... RETURNING id`
                                `cursor.lastrowid` behavior in the and fetch the returned row
                                same way.                          for generated IDs.

  SQL query failed after        PostgreSQL uses `%s` parameter     Updated parameterized
  database migration            placeholders with Psycopg, not     queries to the Psycopg
                                SQLite's `?` placeholders.         placeholder syntax and
                                                                   retested.

  Backend health probe failed   `/health` was not implemented as a Added a dedicated backend
                                backend API endpoint and was       health endpoint returning
                                treated as a static-file request.  HTTP 200 and redeployed a
                                                                   new image.

  Frontend pods entered         Nginx still referenced the Docker  Changed the upstream to
  `CrashLoopBackOff`            Compose service name `backend`;    `orderflow-backend:8000`,
                                Kubernetes service discovery uses  rebuilt and pushed the
                                the Kubernetes Service name.       frontend image, then
                                                                   verified the rolling
                                                                   update.

  GitHub Actions could not      The GitHub OIDC token claims did   Corrected the
  assume the AWS role           not match the IAM role trust       repository/branch trust
                                policy conditions.                 conditions and verified the
                                                                   workflow identity. Restrict
                                                                   trust to the intended
                                                                   repository and branch.

  GitHub Actions could not push AWS IAM permissions, EKS access    Checked the failing
  an image or deploy to EKS     configuration, and Kubernetes      workflow stage, added only
                                authorization are separate layers. the required AWS
                                                                   permissions/access entry
                                                                   and namespace
                                                                   authorization, then reran
                                                                   the workflow.

  `aws eks update-kubeconfig`   The role lacked the AWS API        Added the required
  returned `AccessDenied`       permission `eks:DescribeCluster`.  describe-cluster permission
                                                                   and retried the command.

  AWS Load Balancer Controller  The cluster's IAM OIDC             Registered/verified the
  had an identity-token/OIDC    provider/trust relationship was    cluster OIDC provider and
  error                         not correctly configured.          corrected the controller
                                                                   role trust relationship.

  Ingress did not deploy as     The Helm chart initially did not   Added the Ingress template
  expected                      include the Ingress template, and  and handled resource
                                existing resources had been        ownership carefully during
                                managed outside Helm.              migration. Validate chart
                                                                   output before applying
                                                                   changes.

  Helm reported field ownership Existing image fields had been     Inspected `managedFields`
  conflicts                     updated by `kubectl set image`,    and resolved ownership
                                while Helm was attempting to       deliberately during the
                                manage the same fields.            migration to Helm. Avoid
                                                                   letting multiple deployment
                                                                   tools continuously manage
                                                                   the same fields.

  Helm deployment failed        A chart template referenced a      Compared rendered manifests
  because a value/Secret        Secret/configuration name that did with actual Kubernetes
  reference was inconsistent    not match the existing resource.   resource names and
                                                                   corrected the reference
                                                                   before redeploying.
                                                                   `helm lint` cannot confirm
                                                                   that an external Secret
                                                                   exists.

  Grafana was OOMKilled         The configured memory limit was    Increased the memory limit
                                too low for the monitoring         and verified the pod became
                                workload.                          stable. Size resource
                                                                   requests and limits based
                                                                   on observed use.

  HPA showed CPU as `<unknown>` Metrics Server was not             Installed Metrics Server,
                                installed/working, so Kubernetes   checked `kubectl top`, then
                                had no resource metrics for the    verified HPA CPU metrics.
                                HPA.                               

  Hardcoded load balancer       The hostname changed after the     Updated CI/CD to read the
  hostname stopped working      Ingress/load balancer was          hostname from the Ingress
                                recreated.                         status dynamically before
                                                                   endpoint validation.

  ECR image tag could not be    The repository used immutable tags Tagged images with the Git
  reused                        or the requested tag already       commit SHA so every build
                                existed.                           has a unique, traceable
                                                                   tag.
  --------------------------------------------------------------------------------------------

## Troubleshooting scenarios

Use a repeatable process: **observe → narrow down the failing layer →
inspect logs/events/configuration → make one targeted change → verify
recovery**. Avoid changing IAM permissions or rebuilding infrastructure
before identifying the actual failing stage.

### 1. A backend pod is not running

``` powershell
kubectl get pods -n orderflow -l app=orderflow-backend -o wide
kubectl describe pod <pod-name> -n orderflow
kubectl logs <pod-name> -n orderflow
kubectl logs <pod-name> -n orderflow --previous
kubectl get events -n orderflow --sort-by='.lastTimestamp' | Select-Object -Last 15
```

Look for `CrashLoopBackOff`, `ImagePullBackOff`, failed probes, missing
configuration, scheduling errors, and application exceptions. If the pod
has restarted, `--previous` can reveal the error from the prior
container instance.

### 2. The frontend loads but API calls fail

1.  Check frontend logs and the Nginx upstream configuration.
2.  Confirm the backend Service name and port:
    `kubectl get svc -n orderflow`
3.  Confirm backend pods are Ready:
    `kubectl get pods -n orderflow -l app=orderflow-backend`
4.  Check backend logs and the health endpoint.
5.  Verify Nginx uses the Kubernetes DNS name `orderflow-backend:8000`,
    not the Compose-only name `backend:8000`.

### 3. Backend cannot reach PostgreSQL

1.  Confirm the RDS endpoint, database name, and port in the
    non-sensitive configuration.
2.  Confirm the Kubernetes Secret exists and is referenced by the
    backend Deployment.
3.  Check that the RDS security group allows TCP `5432` from the
    intended EKS/application security group.
4.  Verify RDS is available and the endpoint is current.
5.  Inspect backend logs for authentication, DNS, timeout, TLS, or SQL
    errors.
6.  Never print passwords or paste secrets into CI logs.

### 4. GitHub Actions fails at AWS authentication

Check the exact failed step. For an OIDC assume-role failure, inspect
the role's trust policy and ensure the repository/branch conditions
match the workflow token. Confirm the workflow has the necessary
`id-token: write` permission. Do not solve an OIDC trust mismatch by
storing long-lived access keys unless there is a deliberate, approved
reason.

### 5. GitHub Actions authenticates but cannot deploy

Separate the possible layers:

-   Can the workflow assume the IAM role?
-   Does the role have the required AWS API permissions?
-   Does the cluster recognize the role through EKS access
    configuration?
-   Does the identity have Kubernetes authorization in the `orderflow`
    namespace?
-   Are namespace, Helm chart path, release name, image repositories,
    and tags correct?

Use the workflow logs to identify the exact failed stage before changing
access policies.

### 6. New image is in ECR but pods keep using an old version

-   Confirm the workflow pushed the expected commit-SHA tag.
-   Inspect the Deployment image:
    `kubectl describe deployment orderflow-backend -n orderflow`
-   Inspect the running image references:
    `kubectl get pods -n orderflow -o wide`
-   Verify the Helm values/image tag used by the release.
-   Wait for rollout completion:
    `kubectl rollout status deployment/orderflow-backend -n orderflow`

Unique image tags improve traceability and avoid ambiguity about which
build is deployed.

### 7. HPA does not scale or shows unknown metrics

``` powershell
kubectl top nodes
kubectl top pods -n orderflow
kubectl get hpa -n orderflow
kubectl describe hpa orderflow-backend -n orderflow
```

If metrics are unavailable, check Metrics Server and its pods/logs. If
metrics are present but the HPA does not scale, inspect the target CPU
utilization, resource requests, current utilization, and HPA events. Do
not generate CPU load on a shared or production system.

### 8. Ingress hostname is missing or endpoint check fails

``` powershell
kubectl get ingress -n orderflow
kubectl describe ingress orderflow-ingress -n orderflow
kubectl get pods -A | Select-String "load-balancer"
kubectl get events -n orderflow --sort-by='.lastTimestamp' | Select-Object -Last 20
```

Check that the AWS Load Balancer Controller is running, the Ingress has
valid configuration, and its hostname has been assigned. Use the current
hostname from the Ingress status instead of a saved hostname from an
earlier deployment.

### 9. Terraform proposes unexpected changes

1.  Confirm the working directory and AWS account/region.
2.  Check the selected backend/workspace/environment.
3.  Run `terraform fmt` and `terraform validate`.
4.  Review the complete `terraform plan`.
5.  Inspect state/backend configuration and module outputs.
6.  Do not apply a plan that unexpectedly replaces a database, cluster,
    or network resource.

## Future improvements

These are potential next steps, not claims that they are already
implemented.

-   **Environment separation:** Create separate development and
    production configurations with environment-specific Helm values and
    Terraform variables.
-   **Secrets management:** Integrate AWS Secrets Manager or Systems
    Manager Parameter Store and a secure Kubernetes integration rather
    than managing long-lived database passwords manually.
-   **Least privilege:** Review the GitHub Actions IAM role and EKS
    permissions; keep deployment access scoped to required repositories,
    resources, and namespaces.
-   **Production database resilience:** Enable and test automated
    backups, point-in-time recovery, maintenance planning, and a
    documented recovery procedure.
-   **Monitoring and alerts:** Add actionable alerts for pod restarts,
    unavailable replicas, high CPU/memory, elevated API errors, latency,
    and RDS health.
-   **Persistent monitoring storage:** Configure durable Prometheus
    storage and retention appropriate to the environment instead of
    short-lived development settings.
-   **Application tests:** Add unit, integration, API smoke, and
    database migration tests to CI before image publication.
-   **Security scanning:** Scan container images and dependencies; add
    static analysis and secret scanning.
-   **Deployment safety:** Add explicit deployment approvals for
    production, Helm rollback guidance, and a tested rollback procedure.
-   **Ingress hardening:** Add HTTPS/TLS, an appropriate DNS name, and
    restrictive network policies where suitable.
-   **Policy and quality checks:** Add Terraform security scanning,
    formatting/validation checks, and Helm manifest validation to the
    pipeline.
-   **Cost controls:** Add budgets/alerts and review load balancer, NAT
    Gateway, EKS node, RDS, and monitoring costs. Shut down only
    resources that are safe to stop and that you explicitly intend to
    pause.
-   **Documentation:** Keep architecture diagrams, sanitized
    screenshots, runbooks, and a dated troubleshooting log updated as
    the project evolves.

## Important security notes

-   Never commit AWS access keys, database passwords, JWT secrets,
    Terraform state, kubeconfig files, or secret-bearing variable files.
-   Do not expose RDS/PostgreSQL directly to the internet.
-   Keep database credentials in a Kubernetes Secret or a dedicated
    secrets service, not in Helm values or container images.
-   Use GitHub OIDC with a restricted trust policy and short-lived AWS
    credentials.
-   Treat Kubernetes Secrets as sensitive; base64 encoding is not
    encryption by itself. Restrict access and use appropriate encryption
    and secret-management controls.
-   Sanitize screenshots and logs before publishing. Remove account
    identifiers, tokens, hostnames if considered sensitive, customer
    data, and credentials where appropriate.
-   The settings in this repository are for a learning/portfolio
    environment. Review availability, security, compliance, backup,
    scaling, and cost requirements before using a similar design for
    production.

## Project summary

OrderFlow demonstrates a complete cloud-native deployment path: a
locally tested multi-tier application, Docker containers,
Terraform-provisioned AWS infrastructure, EKS workloads managed with
Helm, ECR image publishing, GitHub Actions deployment using OIDC, and
monitoring with Prometheus, Grafana, and CloudWatch. The troubleshooting
record is a key part of the project: it shows how to isolate failures
across application code, container configuration, Kubernetes networking,
AWS networking, IAM/OIDC, Helm ownership, metrics collection, and
resource sizing.
