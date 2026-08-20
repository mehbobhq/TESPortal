import { Save } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"

export default function ProfilePage() {
  return (
    <>
      <PageHeader
        title="Profile"
        description="Manage your personal details, role, and account security."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Your account</CardTitle>
            <CardDescription>How you appear across the portal.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4 text-center">
            <Avatar className="size-20">
              <AvatarFallback className="text-xl">U</AvatarFallback>
            </Avatar>
            <div className="flex flex-col gap-1">
              <p className="text-lg font-semibold">User Name</p>
              <p className="text-muted-foreground text-sm">Role</p>
            </div>
            <Badge variant="secondary">User</Badge>
            <Separator />
            <div className="flex w-full flex-col gap-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Member since</span>
                <span className="font-medium">N/A</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Last login</span>
                <span className="font-medium">N/A</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Personal information</CardTitle>
            <CardDescription>Update your name, contact details, and role.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="firstName">First name</FieldLabel>
                  <Input id="firstName" placeholder="First name" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="lastName">Last name</FieldLabel>
                  <Input id="lastName" placeholder="Last name" />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input id="email" type="email" placeholder="email@example.com" />
                <FieldDescription>Used for sign-in and system notifications.</FieldDescription>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="phone">Phone</FieldLabel>
                  <Input id="phone" type="tel" placeholder="+1 (555) 000-0000" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="role">Role / title</FieldLabel>
                  <Input id="role" placeholder="Role / title" />
                </Field>
              </div>
            </FieldGroup>
          </CardContent>
          <CardFooter className="justify-end">
            <Button>
              <Save data-icon="inline-start" />
              Save changes
            </Button>
          </CardFooter>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Security</CardTitle>
            <CardDescription>Change your password to keep your account secure.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field>
                  <FieldLabel htmlFor="current">Current password</FieldLabel>
                  <Input id="current" type="password" placeholder="••••••••" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="new">New password</FieldLabel>
                  <Input id="new" type="password" placeholder="••••••••" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="confirm">Confirm password</FieldLabel>
                  <Input id="confirm" type="password" placeholder="••••••••" />
                </Field>
              </div>
            </FieldGroup>
          </CardContent>
          <CardFooter className="justify-end">
            <Button variant="outline">Update password</Button>
          </CardFooter>
        </Card>
      </div>
    </>
  )
}
