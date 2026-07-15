# SignPath Foundation Setup

JunQi uses SignPath Foundation for free Authenticode signing of tagged Windows
releases. Private signing keys remain in SignPath; the repository does not use
or store a PFX.

## Apply

1. Submit the public repository at <https://signpath.org/apply>.
2. Install the SignPath GitHub App for `smartrealm/openclaw-junqi` when SignPath
   requests repository access.
3. In SignPath, link the project to the predefined `GitHub.com` trusted build
   system.
4. Create a release signing policy that permits this repository's tag workflow.

## Artifact Configurations

Create the `windows-application` artifact configuration:

```xml
<artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
  <zip-file>
    <pe-file path="junqi-desktop.exe">
      <authenticode-sign/>
    </pe-file>
  </zip-file>
</artifact-configuration>
```

Create the `windows-installers` artifact configuration:

```xml
<artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
  <zip-file>
    <directory path="nsis">
      <pe-file path="JunQi Desktop_*-setup.exe">
        <authenticode-sign/>
      </pe-file>
    </directory>
    <directory path="msi">
      <msi-file path="JunQi Desktop_*.msi">
        <authenticode-sign/>
      </msi-file>
    </directory>
  </zip-file>
</artifact-configuration>
```

The application is signed before Tauri bundles it, so both installers contain
the signed executable. The installer request then signs the NSIS and MSI outer
containers. After SignPath returns them, the workflow creates new Tauri updater
signatures over the final Authenticode-signed bytes.

## Repository Secrets

Configure these GitHub Actions secrets after SignPath approves the project:

- `SIGNPATH_API_TOKEN`
- `SIGNPATH_ORGANIZATION_ID`
- `SIGNPATH_PROJECT_SLUG`
- `SIGNPATH_SIGNING_POLICY_SLUG`
- `SIGNPATH_APPLICATION_ARTIFACT_CONFIGURATION_SLUG`
- `SIGNPATH_INSTALLER_ARTIFACT_CONFIGURATION_SLUG`

Tagged Windows builds fail before signing when any value is missing. Main
branch builds remain unsigned, short-lived CI artifacts and are never published
as a GitHub Release.
