terraform {
  backend "s3" {
    bucket         = "orderflow-terraform-state-sg"
    key            = "orderflow/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "orderflow-terraform-lock"
    encrypt        = true
  }
}

output "vpc_id" {
  description = "OrderFlow VPC ID."
  value       = module.vpc.vpc_id
}

output "vpc_cidr" {
  description = "OrderFlow VPC CIDR."
  value       = module.vpc.vpc_cidr
}

output "availability_zones" {
  description = "Availability Zones used by the project."
  value       = module.vpc.availability_zones
}

output "public_subnet_ids" {
  description = "Public subnet IDs"
  value       = module.vpc.public_subnet_ids
}

output "private_subnet_ids" {
  description = "Private subnet IDs"
  value       = module.vpc.private_subnet_ids
}

output "nat_gateway_id" {
  description = "NAT Gateway ID"
  value       = module.vpc.nat_gateway_id
}

output "eks_cluster_name" {
  value = module.eks.cluster_name
}

output "eks_cluster_endpoint" {
  value = module.eks.cluster_endpoint
}

output "eks_cluster_arn" {
  value = module.eks.cluster_arn
}